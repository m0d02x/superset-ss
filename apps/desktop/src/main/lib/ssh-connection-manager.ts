import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import type {
	ServerAuthMethod,
	ServerStatus,
} from "@superset/local-db/schema/zod";
import {
	HYPERSET_TMUX,
	HYPERSET_TMUX_CONF,
	HYPERSET_TMUX_CONF_CONTENT,
	HYPERSET_TMUX_SOCKET,
	isHypersetSession,
} from "shared/tmux";
import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";

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
	tmuxSession?: string;
}

const MAX_CONCURRENT_EXEC = 5;
const MAX_CONCURRENT_SHELL_OPEN = 3;
const MAX_TOTAL_CHANNELS = 8;
const SHELL_OPEN_RETRY_DELAY_MS = 500;
const SHELL_OPEN_MAX_RETRIES = 3;

class SSHConnectionManager extends EventEmitter {
	private connections = new Map<string, SSHConnectionEntry>();
	private shells = new Map<string, ShellSession>();
	private execConcurrency = new Map<string, number>();
	private execQueues = new Map<string, Array<() => void>>();
	private shellOpenConcurrency = new Map<string, number>();
	private shellOpenQueues = new Map<string, Array<() => void>>();

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
				// Write our managed tmux config, then clean up any stale
				// hyperset tmux socket from previous app runs
				this.ensureTmuxConfig(config.serverId)
					.then(() => this.cleanupStaleTmuxSocket(config.serverId))
					.catch(() => {});
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

		await this.acquireExecSlot(serverId);
		try {
			return await new Promise((resolve, reject) => {
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
		} finally {
			this.releaseExecSlot(serverId);
		}
	}

	async uploadFile(
		serverId: string,
		localPath: string,
		remotePath: string,
	): Promise<void> {
		const entry = this.connections.get(serverId);
		if (!entry) {
			throw new Error(`Not connected to server ${serverId}`);
		}

		await this.waitForChannelCapacity(serverId);
		await this.exec(
			serverId,
			`mkdir -p ${JSON.stringify(dirname(remotePath))} 2>/dev/null`,
		);

		const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
			entry.client.sftp((error, nextSftp) => {
				if (error) {
					reject(error);
					return;
				}

				resolve(nextSftp);
			});
		});

		await new Promise<void>((resolve, reject) => {
			sftp.fastPut(localPath, remotePath, (error) => {
				sftp.end();
				if (error) {
					reject(error);
					return;
				}

				resolve();
			});
		});
	}

	private acquireExecSlot(serverId: string): Promise<void> {
		const active = this.execConcurrency.get(serverId) ?? 0;
		if (active < MAX_CONCURRENT_EXEC) {
			this.execConcurrency.set(serverId, active + 1);
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			const queue = this.execQueues.get(serverId) ?? [];
			queue.push(resolve);
			this.execQueues.set(serverId, queue);
		});
	}

	private releaseExecSlot(serverId: string): void {
		const queue = this.execQueues.get(serverId);
		if (queue && queue.length > 0) {
			const next = queue.shift();
			if (queue.length === 0) this.execQueues.delete(serverId);
			next?.();
		} else {
			const active = this.execConcurrency.get(serverId) ?? 1;
			this.execConcurrency.set(serverId, active - 1);
		}
		this.emit("channelReleased");
	}

	private acquireShellOpenSlot(serverId: string): Promise<void> {
		const active = this.shellOpenConcurrency.get(serverId) ?? 0;
		if (active < MAX_CONCURRENT_SHELL_OPEN) {
			this.shellOpenConcurrency.set(serverId, active + 1);
			return Promise.resolve();
		}
		return new Promise<void>((resolve) => {
			const queue = this.shellOpenQueues.get(serverId) ?? [];
			queue.push(resolve);
			this.shellOpenQueues.set(serverId, queue);
		});
	}

	private releaseShellOpenSlot(serverId: string): void {
		const queue = this.shellOpenQueues.get(serverId);
		if (queue && queue.length > 0) {
			const next = queue.shift();
			if (queue.length === 0) this.shellOpenQueues.delete(serverId);
			next?.();
		} else {
			const active = this.shellOpenConcurrency.get(serverId) ?? 1;
			this.shellOpenConcurrency.set(serverId, active - 1);
		}
	}

	/** Count active channels (shells + execs) for a server */
	private getActiveChannelCount(serverId: string): number {
		let count = 0;
		for (const session of this.shells.values()) {
			if (session.serverId === serverId) count++;
		}
		count += this.execConcurrency.get(serverId) ?? 0;
		return count;
	}

	/** Wait until total channel count drops below the limit (5s timeout) */
	private async waitForChannelCapacity(serverId: string): Promise<void> {
		if (this.getActiveChannelCount(serverId) < MAX_TOTAL_CHANNELS) return;

		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				this.removeListener("channelReleased", check);
				resolve(); // Proceed anyway after timeout — let the retry loop handle failure
			}, 5_000);

			const check = () => {
				if (this.getActiveChannelCount(serverId) < MAX_TOTAL_CHANNELS) {
					clearTimeout(timeout);
					this.removeListener("channelReleased", check);
					resolve();
				}
			};
			this.on("channelReleased", check);
		});
	}

	/** Open an interactive PTY shell session, returns session ID */
	async openShell(
		serverId: string,
		opts: { cols: number; rows: number; cwd?: string; tmuxSession?: string },
	): Promise<string> {
		const entry = this.connections.get(serverId);
		if (!entry) {
			throw new Error(`Not connected to server ${serverId}`);
		}

		// Gate on total channel capacity before acquiring the open slot
		await this.waitForChannelCapacity(serverId);
		await this.acquireShellOpenSlot(serverId);

		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= SHELL_OPEN_MAX_RETRIES; attempt++) {
			try {
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

				this.releaseShellOpenSlot(serverId);

				const sessionId = randomUUID();
				this.shells.set(sessionId, {
					id: sessionId,
					serverId,
					stream,
					tmuxSession: opts.tmuxSession,
				});

				// Emit shell data events
				stream.on("data", (data: Buffer) => {
					this.emit(`shell:data:${sessionId}`, data.toString());
				});
				stream.on("close", () => {
					this.emit(`shell:close:${sessionId}`);
					this.shells.delete(sessionId);
					this.emit("channelReleased");
				});

				if (opts.tmuxSession) {
					// Use tmux for persistent sessions.
					// -A: attach if session exists, create if not
					// -s: session name
					// -c: starting directory (only applies on new session creation)
					const name = this.sanitizeTmuxName(opts.tmuxSession);
					const cwdArg = opts.cwd
						? ` -c ${this.shellQuote(opts.cwd.trim())}`
						: "";
					// Hyperset sessions (ss-*) run on our private socket with our
					// managed config; external sessions attach on the user's
					// default socket with their own ~/.tmux.conf.
					const tmuxCmd = isHypersetSession(name)
						? `${HYPERSET_TMUX} -f ${HYPERSET_TMUX_CONF}`
						: "tmux";
					// Escape sequence notes (DO NOT "simplify" — see below):
					// - \033[2J\033[H (clear screen + home cursor) preserves xterm
					//   scrollback. \033c (full RIS reset) would wipe it on every attach.
					// - '\; set mouse on' chains a tmux command: single-quoted \; is
					//   tmux's internal separator (not bash's). Enables wheel scroll via
					//   tmux copy-mode (pane history survives reconnects) + mouse
					//   forwarding to TUI apps. Idempotent per attach.
					stream.write(
						`printf '\\033[2J\\033[H'; TMUX= ${tmuxCmd} new-session -As ${name}${cwdArg} '\\;' set mouse on\n`,
					);
				} else if (opts.cwd) {
					const targetCwd = opts.cwd.trim();
					const cdCommand = targetCwd.startsWith("~/")
						? `cd ~/${JSON.stringify(targetCwd.slice(2))}`
						: targetCwd === "~"
							? "cd ~"
							: `cd ${JSON.stringify(targetCwd)}`;
					stream.write(`${cdCommand} && clear\n`);
				}

				return sessionId;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				const isChannelFailure = lastError.message.includes(
					"Channel open failure",
				);

				if (!isChannelFailure || attempt >= SHELL_OPEN_MAX_RETRIES) {
					break;
				}
				// Wait before retrying to let channels free up
				await new Promise((r) =>
					setTimeout(r, SHELL_OPEN_RETRY_DELAY_MS * attempt),
				);
			}
		}

		this.releaseShellOpenSlot(serverId);
		throw lastError ?? new Error("Failed to open shell");
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

	/**
	 * Close a shell session.
	 * @param killTmux - if true, also kill the remote tmux session. Pass false
	 *   when reconnecting so the tmux session survives for reattach.
	 */
	closeShell(sessionId: string, killTmux = true): void {
		const session = this.shells.get(sessionId);
		if (!session) return;

		// Remove from map immediately to free the slot for channel counting
		this.shells.delete(sessionId);

		if (killTmux && session.tmuxSession) {
			// Kill the tmux session via a separate exec so it reliably runs
			// before we tear down the shell channel.
			const name = this.sanitizeTmuxName(session.tmuxSession);
			const tmuxCmd = isHypersetSession(name) ? HYPERSET_TMUX : "tmux";
			this.exec(
				session.serverId,
				`${tmuxCmd} kill-session -t ${name} 2>/dev/null`,
			)
				.catch(() => {})
				.finally(() => {
					session.stream.close();
					this.emit("channelReleased");
				});
		} else {
			session.stream.close();
			this.emit("channelReleased");
		}
	}

	/** Sanitize a tmux session name (alphanumeric, dash, underscore only) */
	private sanitizeTmuxName(name: string): string {
		return name.replace(/[^a-zA-Z0-9_-]/g, "-");
	}

	/** Shell-quote a string for safe use in a remote command */
	private shellQuote(s: string): string {
		return `'${s.replace(/'/g, "'\\''")}'`;
	}

	/**
	 * Write the Hyperset-managed tmux config to the remote host.
	 * Loaded via `-f` when the hyperset tmux server starts, so behavior
	 * doesn't depend on the user's ~/.tmux.conf.
	 */
	private async ensureTmuxConfig(serverId: string): Promise<void> {
		const confDir = HYPERSET_TMUX_CONF.slice(
			0,
			HYPERSET_TMUX_CONF.lastIndexOf("/"),
		);
		await this.exec(
			serverId,
			`mkdir -p ${confDir} && cat > ${HYPERSET_TMUX_CONF} <<'HYPERSET_EOF'\n${HYPERSET_TMUX_CONF_CONTENT}HYPERSET_EOF`,
		);
	}

	/** Clean up a stale hyperset tmux socket if the server process died */
	private async cleanupStaleTmuxSocket(serverId: string): Promise<void> {
		const result = await this.exec(
			serverId,
			`${HYPERSET_TMUX} list-sessions -F '#{session_name}' 2>/dev/null`,
		);
		if (result.code !== 0) {
			// The hyperset tmux server may have a stale socket from a crash
			// or kill — remove only our socket so the next new-session can
			// start fresh. Never touch the user's default tmux socket.
			await this.exec(
				serverId,
				`rm -f /tmp/tmux-$(id -u)/${HYPERSET_TMUX_SOCKET} 2>/dev/null`,
			);
		}
		// Don't kill detached ss-* sessions — they're restored as tabs
		// when the user opens the space.
	}

	disconnect(serverId: string): void {
		const entry = this.connections.get(serverId);
		if (!entry) return;

		// Clean up all shells for this server
		for (const [sessionId, session] of this.shells) {
			if (session.serverId === serverId) {
				this.shells.delete(sessionId);
			}
		}

		// Reset concurrency tracking for this server
		this.execConcurrency.delete(serverId);
		this.execQueues.delete(serverId);
		this.shellOpenConcurrency.delete(serverId);
		this.shellOpenQueues.delete(serverId);

		entry.client.end();
		this.connections.delete(serverId);
		this.emitStatus(serverId, "disconnected");
		this.emit("channelReleased");
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
