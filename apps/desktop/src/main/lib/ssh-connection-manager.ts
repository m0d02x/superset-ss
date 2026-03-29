import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type {
	ServerAuthMethod,
	ServerStatus,
} from "@superset/local-db/schema/zod";
import { Client, type ClientChannel } from "ssh2";

export interface SSHConnectConfig {
	serverId: string;
	host: string;
	port: number;
	username: string;
	authMethod: ServerAuthMethod;
	sshKeyPath?: string;
	password?: string;
}

export interface SSHConnectionEntry {
	client: Client;
}

export interface SSHExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface ShellSession {
	id: string;
	serverId: string;
	stream: ClientChannel;
}

class SSHConnectionManager extends EventEmitter {
	private connections = new Map<string, SSHConnectionEntry>();
	private shells = new Map<string, ShellSession>();

	async connect(config: SSHConnectConfig): Promise<void> {
		if (this.connections.has(config.serverId)) {
			this.disconnect(config.serverId);
		}

		this.emitStatus(config.serverId, "connecting");

		const client = new Client();

		return new Promise<void>((resolve, reject) => {
			const connectTimeout = setTimeout(() => {
				client.end();
				reject(new Error("SSH connection timed out after 30s"));
			}, 30_000);

			client.on("ready", () => {
				clearTimeout(connectTimeout);
				this.connections.set(config.serverId, { client });
				this.emitStatus(config.serverId, "connected");
				resolve();
			});

			client.on("error", (err) => {
				clearTimeout(connectTimeout);
				this.emitStatus(config.serverId, "error", err.message);
				this.connections.delete(config.serverId);
				reject(err);
			});

			client.on("end", () => {
				this.emitStatus(config.serverId, "disconnected");
				this.connections.delete(config.serverId);
			});

			client.on("close", () => {
				this.emitStatus(config.serverId, "disconnected");
				this.connections.delete(config.serverId);
			});

			const connectConfig: Record<string, unknown> = {
				host: config.host,
				port: config.port,
				username: config.username,
				keepaliveInterval: 15_000,
				keepaliveCountMax: 3,
				readyTimeout: 30_000,
			};

			if (config.authMethod === "key" && config.sshKeyPath) {
				try {
					const resolvedPath = config.sshKeyPath.startsWith("~")
						? config.sshKeyPath.replace("~", homedir())
						: config.sshKeyPath;
					connectConfig.privateKey = readFileSync(resolvedPath);
				} catch (err) {
					clearTimeout(connectTimeout);
					reject(
						new Error(
							`Failed to read SSH key at ${config.sshKeyPath}: ${err instanceof Error ? err.message : "Unknown error"}`,
						),
					);
					return;
				}
			} else if (config.authMethod === "password" && config.password) {
				connectConfig.password = config.password;
			} else if (config.authMethod === "agent") {
				connectConfig.agent = process.env.SSH_AUTH_SOCK;
			}

			client.connect(connectConfig as Parameters<Client["connect"]>[0]);
		});
	}

	/** Execute a command over SSH and return stdout/stderr/code */
	async exec(serverId: string, command: string): Promise<SSHExecResult> {
		const entry = this.connections.get(serverId);
		if (!entry) {
			throw new Error(`Not connected to server ${serverId}`);
		}

		return new Promise((resolve, reject) => {
			entry.client.exec(command, (err, stream) => {
				if (err) {
					reject(err);
					return;
				}

				let stdout = "";
				let stderr = "";

				stream.on("data", (data: Buffer) => {
					stdout += data.toString();
				});
				stream.stderr.on("data", (data: Buffer) => {
					stderr += data.toString();
				});
				stream.on("close", (code: number) => {
					resolve({ stdout, stderr, code: code ?? 0 });
				});
			});
		});
	}

	/** Open an interactive PTY shell session, returns session ID */
	async openShell(
		serverId: string,
		opts: { cols: number; rows: number; cwd?: string },
	): Promise<string> {
		const entry = this.connections.get(serverId);
		if (!entry) {
			throw new Error(`Not connected to server ${serverId}`);
		}

		const stream = await new Promise<ClientChannel>((resolve, reject) => {
			entry.client.shell(
				{
					term: "xterm-256color",
					cols: opts.cols,
					rows: opts.rows,
				},
				(err, s) => {
					if (err) reject(err);
					else resolve(s);
				},
			);
		});

		const sessionId = randomUUID();
		this.shells.set(sessionId, { id: sessionId, serverId, stream });

		if (opts.cwd) {
			const targetCwd = opts.cwd.trim();
			const cdCommand = targetCwd.startsWith("~/")
				? `cd ~/${JSON.stringify(targetCwd.slice(2))}`
				: targetCwd === "~"
					? "cd ~"
					: `cd ${JSON.stringify(targetCwd)}`;
			stream.write(`${cdCommand} && clear\n`);
		}

		// Emit shell data events
		stream.on("data", (data: Buffer) => {
			this.emit(`shell:data:${sessionId}`, data.toString());
		});
		stream.on("close", () => {
			this.emit(`shell:close:${sessionId}`);
			this.shells.delete(sessionId);
		});

		return sessionId;
	}

	/** Write data to a shell session */
	writeShell(sessionId: string, data: string): void {
		const session = this.shells.get(sessionId);
		if (!session) return;
		session.stream.write(data);
	}

	/** Resize a shell session */
	resizeShell(sessionId: string, cols: number, rows: number): void {
		const session = this.shells.get(sessionId);
		if (!session) return;
		session.stream.setWindow(rows, cols, 0, 0);
	}

	/** Close a shell session */
	closeShell(sessionId: string): void {
		const session = this.shells.get(sessionId);
		if (!session) return;
		session.stream.close();
		this.shells.delete(sessionId);
	}

	disconnect(serverId: string): void {
		const entry = this.connections.get(serverId);
		if (!entry) return;

		entry.client.end();
		this.connections.delete(serverId);
		this.emitStatus(serverId, "disconnected");
	}

	disconnectAll(): void {
		for (const serverId of this.connections.keys()) {
			this.disconnect(serverId);
		}
	}

	isConnected(serverId: string): boolean {
		return this.connections.has(serverId);
	}

	getAll(): Map<string, SSHConnectionEntry> {
		return this.connections;
	}

	private emitStatus(
		serverId: string,
		status: ServerStatus,
		message?: string,
	): void {
		this.emit("statusChange", { serverId, status, message });
	}
}

// Singleton
let manager: SSHConnectionManager | null = null;

export function getSSHConnectionManager(): SSHConnectionManager {
	if (!manager) {
		manager = new SSHConnectionManager();
	}
	return manager;
}
