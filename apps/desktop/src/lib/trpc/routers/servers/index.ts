import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
	projects,
	type SelectProject,
	type SelectServer,
	serverSpaces,
	servers,
	serverTerminalSessions,
	workspaces,
	worktrees,
} from "@superset/local-db";
import { SERVER_AUTH_METHODS } from "@superset/local-db/schema/zod";
import { observable } from "@trpc/server/observable";
import { and, eq } from "drizzle-orm";
import { dialog } from "electron";
import { localDb } from "main/lib/local-db";
import { getSSHConnectionManager } from "main/lib/ssh-connection-manager";
import { stripTerminalAutoResponses } from "main/lib/terminal-escape-filter";
import { resolveServerSpaceDirectory } from "shared/server-paths";
import { z } from "zod";
import { publicProcedure, router } from "../..";

let hasRegisteredServerStatusPersistence = false;

function registerServerStatusPersistence(): void {
	if (hasRegisteredServerStatusPersistence) {
		return;
	}
	const manager = getSSHConnectionManager();
	manager.on("statusChange", persistServerStatus);
	hasRegisteredServerStatusPersistence = true;
}

async function resolveRenamedRemotePath(
	manager: ReturnType<typeof getSSHConnectionManager>,
	serverId: string,
	targetPath: string,
): Promise<string> {
	const extensionIndex = targetPath.lastIndexOf(".");
	const slashIndex = targetPath.lastIndexOf("/");
	const hasExtension = extensionIndex > slashIndex;
	const basePath = hasExtension
		? targetPath.slice(0, extensionIndex)
		: targetPath;
	const extension = hasExtension ? targetPath.slice(extensionIndex) : "";

	for (let attempt = 1; attempt <= 100; attempt += 1) {
		const candidatePath = `${basePath} (${attempt})${extension}`;
		const existsResult = await manager.exec(
			serverId,
			`if [ -e ${JSON.stringify(candidatePath)} ]; then exit 0; else exit 1; fi`,
		);

		if (existsResult.code !== 0) {
			return candidatePath;
		}
	}

	throw new Error("Could not find an available renamed upload path");
}

function persistServerStatus(event: {
	serverId: string;
	status: SelectServer["status"];
	message?: string;
}): void {
	const existingServer = localDb
		.select({ id: servers.id })
		.from(servers)
		.where(eq(servers.id, event.serverId))
		.get();

	if (!existingServer) {
		return;
	}

	localDb
		.update(servers)
		.set({
			status: event.status,
			statusMessage: event.message ?? null,
			lastConnectedAt: event.status === "connected" ? Date.now() : undefined,
			updatedAt: Date.now(),
		})
		.where(eq(servers.id, event.serverId))
		.run();
}

async function reconnectServer(serverId: string): Promise<void> {
	const server = localDb
		.select()
		.from(servers)
		.where(eq(servers.id, serverId))
		.get();

	if (!server) {
		throw new Error(`Server not found: ${serverId}`);
	}

	const manager = getSSHConnectionManager();
	await manager.connect({
		serverId: server.id,
		host: server.host,
		port: server.port,
		username: server.username,
		authMethod: server.authMethod,
		sshKeyPath: server.sshKeyPath ?? undefined,
	});
}

function shouldForceReconnect(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	return (
		error.message.includes("Not connected to server") ||
		error.message.includes("Channel open failure")
	);
}

const createServerInput = z.object({
	label: z.string().min(1),
	host: z.string().min(1),
	port: z.number().int().min(1).max(65535).default(22),
	username: z.string().min(1).default("root"),
	authMethod: z.enum(SERVER_AUTH_METHODS).default("key"),
	sshKeyPath: z.string().nullable().optional(),
	homeDirectory: z.string().nullable().optional(),
});

const updateServerInput = z.object({
	id: z.string(),
	label: z.string().min(1).optional(),
	host: z.string().min(1).optional(),
	port: z.number().int().min(1).max(65535).optional(),
	username: z.string().min(1).optional(),
	authMethod: z.enum(SERVER_AUTH_METHODS).optional(),
	sshKeyPath: z.string().nullable().optional(),
	homeDirectory: z.string().nullable().optional(),
});

function normalizeOptionalPath(path: string | null | undefined): string | null {
	const trimmed = path?.trim();
	return trimmed ? trimmed : null;
}

function getServerHomeDirectory(serverId: string): string | null {
	const server = localDb
		.select({ homeDirectory: servers.homeDirectory })
		.from(servers)
		.where(eq(servers.id, serverId))
		.get();

	return server?.homeDirectory ?? null;
}

function resolveSpaceDirectory(
	directory: string | null | undefined,
	serverId: string,
): string | null {
	return (
		resolveServerSpaceDirectory(directory, getServerHomeDirectory(serverId)) ??
		null
	);
}

/**
 * Reconnect all servers that were previously connected. Called from app
 * startup (main process) so SSH connections resume without waiting for
 * the renderer, and from the `reconnectAll` mutation.
 */
export async function reconnectAllServers(): Promise<
	Array<{ id: string; success: boolean; error?: string }>
> {
	registerServerStatusPersistence();
	const allServers = localDb.select().from(servers).all();
	const manager = getSSHConnectionManager();

	const results = await Promise.all(
		allServers
			.filter((server) => server.lastConnectedAt)
			.map(async (server) => {
				try {
					if (manager.isConnected(server.id)) {
						return { id: server.id, success: true };
					}

					await reconnectServer(server.id);
					return { id: server.id, success: true };
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "Unknown error";
					localDb
						.update(servers)
						.set({
							status: "error",
							statusMessage: message,
							updatedAt: Date.now(),
						})
						.where(eq(servers.id, server.id))
						.run();
					return { id: server.id, success: false, error: message };
				}
			}),
	);

	return results;
}

export const createServersRouter = () => {
	registerServerStatusPersistence();

	return router({
		list: publicProcedure.query(() => {
			return localDb.select().from(servers).all();
		}),

		get: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(({ input }) => {
				return localDb
					.select()
					.from(servers)
					.where(eq(servers.id, input.id))
					.get();
			}),

		create: publicProcedure.input(createServerInput).mutation(({ input }) => {
			return localDb
				.insert(servers)
				.values({
					label: input.label,
					host: input.host,
					port: input.port,
					username: input.username,
					authMethod: input.authMethod,
					sshKeyPath: input.sshKeyPath ?? undefined,
					homeDirectory: normalizeOptionalPath(input.homeDirectory),
				})
				.returning()
				.get();
		}),

		update: publicProcedure.input(updateServerInput).mutation(({ input }) => {
			const { id, ...updates } = input;
			return localDb
				.update(servers)
				.set({
					...updates,
					homeDirectory:
						"homeDirectory" in updates
							? normalizeOptionalPath(updates.homeDirectory)
							: undefined,
					updatedAt: Date.now(),
				})
				.where(eq(servers.id, id))
				.returning()
				.get();
		}),

		delete: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => {
				const manager = getSSHConnectionManager();
				if (manager.isConnected(input.id)) {
					manager.disconnect(input.id);
				}
				localDb.delete(servers).where(eq(servers.id, input.id)).run();
				return { success: true };
			}),

		connect: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(async ({ input }) => {
				localDb
					.update(servers)
					.set({
						status: "connecting",
						statusMessage: null,
						updatedAt: Date.now(),
					})
					.where(eq(servers.id, input.id))
					.run();

				try {
					await reconnectServer(input.id);
					const manager = getSSHConnectionManager();

					// Auto-sync worktrees for all remote projects on this server
					const remoteProjects = localDb
						.select()
						.from(projects)
						.where(eq(projects.serverId, input.id))
						.all();

					for (const proj of remoteProjects) {
						if (!proj.remoteRepoPath) continue;
						try {
							await syncRemoteWorktrees(manager, input.id, proj);
						} catch {
							// Non-fatal — just skip sync
						}
					}

					return { success: true };
				} catch (error) {
					const message =
						error instanceof Error ? error.message : "Unknown error";

					localDb
						.update(servers)
						.set({
							status: "error",
							statusMessage: message,
							updatedAt: Date.now(),
						})
						.where(eq(servers.id, input.id))
						.run();

					throw error;
				}
			}),

		disconnect: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => {
				const manager = getSSHConnectionManager();
				manager.disconnect(input.id);

				localDb
					.update(servers)
					.set({
						status: "disconnected",
						statusMessage: null,
						updatedAt: Date.now(),
					})
					.where(eq(servers.id, input.id))
					.run();

				return { success: true };
			}),

		/** Run a command on the remote server via SSH */
		exec: publicProcedure
			.input(
				z.object({
					id: z.string(),
					command: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const manager = getSSHConnectionManager();
				return manager.exec(input.id, input.command);
			}),

		/** Get system info from connected server */
		info: publicProcedure
			.input(z.object({ id: z.string() }))
			.query(async ({ input }) => {
				const manager = getSSHConnectionManager();
				if (!manager.isConnected(input.id)) {
					return null;
				}
				const result = await manager.exec(
					input.id,
					"uname -s -m && hostname && uptime -p 2>/dev/null || uptime",
				);
				const lines = result.stdout.trim().split("\n");
				return {
					platform: lines[0] ?? "unknown",
					hostname: lines[1] ?? "unknown",
					uptime: lines[2] ?? "unknown",
				};
			}),

		/** List git worktrees on the remote server */
		listWorktrees: publicProcedure
			.input(
				z.object({
					id: z.string(),
					repoPath: z.string(),
				}),
			)
			.query(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const result = await manager.exec(
					input.id,
					`cd ${JSON.stringify(input.repoPath)} && git worktree list --porcelain`,
				);

				if (result.code !== 0) {
					return [];
				}

				// Parse porcelain output
				const worktrees: Array<{
					path: string;
					head: string;
					branch: string;
				}> = [];
				let current: Record<string, string> = {};

				for (const line of result.stdout.split("\n")) {
					if (line === "") {
						if (current.worktree) {
							worktrees.push({
								path: current.worktree,
								head: current.HEAD ?? "",
								branch:
									current.branch?.replace("refs/heads/", "") ?? "detached",
							});
						}
						current = {};
					} else {
						const spaceIdx = line.indexOf(" ");
						if (spaceIdx !== -1) {
							current[line.slice(0, spaceIdx)] = line.slice(spaceIdx + 1);
						} else {
							current[line] = "true";
						}
					}
				}
				// Last entry
				if (current.worktree) {
					worktrees.push({
						path: current.worktree,
						head: current.HEAD ?? "",
						branch: current.branch?.replace("refs/heads/", "") ?? "detached",
					});
				}

				return worktrees;
			}),

		/** Create a git worktree on the remote server */
		createWorktree: publicProcedure
			.input(
				z.object({
					id: z.string(),
					repoPath: z.string(),
					branch: z.string(),
					baseBranch: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const worktreePath = `${input.repoPath}/.worktrees/${input.branch}`;
				const base = input.baseBranch ?? "main";

				// Try to add existing branch, fall back to creating new branch
				let result = await manager.exec(
					input.id,
					`cd ${JSON.stringify(input.repoPath)} && git worktree add ${JSON.stringify(worktreePath)} ${JSON.stringify(input.branch)} 2>&1`,
				);

				if (result.code !== 0) {
					result = await manager.exec(
						input.id,
						`cd ${JSON.stringify(input.repoPath)} && git worktree add -b ${JSON.stringify(input.branch)} ${JSON.stringify(worktreePath)} ${JSON.stringify(base)} 2>&1`,
					);
				}

				if (result.code !== 0) {
					throw new Error(
						`Failed to create worktree: ${result.stdout || result.stderr}`,
					);
				}

				return { path: worktreePath, branch: input.branch };
			}),

		/** Auto-reconnect all servers that have lastConnectedAt set */
		reconnectAll: publicProcedure.mutation(() => reconnectAllServers()),

		/** Open a file picker for SSH key selection */
		pickSSHKey: publicProcedure.mutation(async () => {
			const result = await dialog.showOpenDialog({
				title: "Select SSH Private Key",
				defaultPath: `${process.env.HOME ?? ""}/.ssh`,
				properties: ["openFile", "showHiddenFiles"],
			});
			if (result.canceled || result.filePaths.length === 0) {
				return null;
			}
			return result.filePaths[0];
		}),

		/** Sync remote worktrees into local DB so they appear in sidebar */
		syncWorktrees: publicProcedure
			.input(z.object({ serverId: z.string(), projectId: z.string() }))
			.mutation(async ({ input }) => {
				const project = localDb
					.select()
					.from(projects)
					.where(eq(projects.id, input.projectId))
					.get();

				if (!project?.remoteRepoPath || !project.serverId) {
					return { synced: 0 };
				}

				const manager = getSSHConnectionManager();
				const result = await manager.exec(
					input.serverId,
					`cd ${JSON.stringify(project.remoteRepoPath)} && git worktree list --porcelain`,
				);

				if (result.code !== 0) return { synced: 0 };

				// Parse worktrees from porcelain output
				const remoteWorktrees: Array<{
					path: string;
					branch: string;
				}> = [];
				let current: Record<string, string> = {};

				for (const line of result.stdout.split("\n")) {
					if (line === "") {
						if (current.worktree) {
							remoteWorktrees.push({
								path: current.worktree,
								branch:
									current.branch?.replace("refs/heads/", "") ?? "detached",
							});
						}
						current = {};
					} else {
						const spaceIdx = line.indexOf(" ");
						if (spaceIdx !== -1) {
							current[line.slice(0, spaceIdx)] = line.slice(spaceIdx + 1);
						} else {
							current[line] = "true";
						}
					}
				}
				if (current.worktree) {
					remoteWorktrees.push({
						path: current.worktree,
						branch: current.branch?.replace("refs/heads/", "") ?? "detached",
					});
				}

				// Get existing worktrees for this project
				const existingWorktrees = localDb
					.select()
					.from(worktrees)
					.where(eq(worktrees.projectId, input.projectId))
					.all();
				const existingPaths = new Set(existingWorktrees.map((w) => w.path));

				let synced = 0;
				const existingWorkspaces = localDb
					.select()
					.from(workspaces)
					.where(eq(workspaces.projectId, input.projectId))
					.all();
				let maxTabOrder = Math.max(
					0,
					...existingWorkspaces.map((w) => w.tabOrder),
				);

				for (const rwt of remoteWorktrees) {
					if (existingPaths.has(rwt.path)) continue;

					// Is this the main repo (not a worktree subfolder)?
					const isMain = rwt.path === project.remoteRepoPath;

					// Create worktree record
					const wt = localDb
						.insert(worktrees)
						.values({
							projectId: input.projectId,
							path: rwt.path,
							branch: rwt.branch,
							createdBySuperset: false,
						})
						.returning()
						.get();

					// Create workspace record
					maxTabOrder += 1;
					localDb
						.insert(workspaces)
						.values({
							projectId: input.projectId,
							worktreeId: wt.id,
							type: isMain ? "branch" : "worktree",
							branch: rwt.branch,
							name: isMain ? "local" : rwt.branch,
							tabOrder: maxTabOrder,
						})
						.run();

					synced += 1;
				}

				return { synced };
			}),

		/** Open a PTY shell session on a remote server */
		openShell: publicProcedure
			.input(
				z.object({
					serverId: z.string(),
					cols: z.number().default(120),
					rows: z.number().default(30),
					cwd: z.string().optional(),
					tmuxSession: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const shellOptions = {
					cols: input.cols,
					rows: input.rows,
					cwd: input.cwd,
					tmuxSession: input.tmuxSession,
				};

				let sessionId: string;

				try {
					sessionId = await manager.openShell(input.serverId, shellOptions);
				} catch (error) {
					if (!shouldForceReconnect(error)) {
						throw error;
					}

					manager.disconnect(input.serverId);
					await reconnectServer(input.serverId);
					sessionId = await manager.openShell(input.serverId, shellOptions);
				}

				return { sessionId };
			}),

		/** Write data to a shell session */
		writeShell: publicProcedure
			.input(z.object({ sessionId: z.string(), data: z.string() }))
			.mutation(({ input }) => {
				const manager = getSSHConnectionManager();
				const data = stripTerminalAutoResponses(input.data);
				if (data.length === 0) return;
				manager.writeShell(input.sessionId, data);
			}),

		/** Resize a shell session */
		resizeShell: publicProcedure
			.input(
				z.object({
					sessionId: z.string(),
					cols: z.number(),
					rows: z.number(),
				}),
			)
			.mutation(({ input }) => {
				const manager = getSSHConnectionManager();
				manager.resizeShell(input.sessionId, input.cols, input.rows);
			}),

		/** Close a shell session */
		closeShell: publicProcedure
			.input(
				z.object({
					sessionId: z.string(),
					killTmux: z.boolean().default(true),
				}),
			)
			.mutation(({ input }) => {
				const manager = getSSHConnectionManager();
				manager.closeShell(input.sessionId, input.killTmux);
			}),

		/** Subscribe to shell session output */
		onShellData: publicProcedure
			.input(z.object({ sessionId: z.string() }))
			.subscription(({ input }) => {
				return observable<{ type: "data"; data: string } | { type: "close" }>(
					(emit) => {
						const manager = getSSHConnectionManager();

						const onData = (data: string) => {
							emit.next({ type: "data", data });
						};
						const onClose = () => {
							emit.next({ type: "close" });
						};

						manager.on(`shell:data:${input.sessionId}`, onData);
						manager.on(`shell:close:${input.sessionId}`, onClose);

						return () => {
							manager.off(`shell:data:${input.sessionId}`, onData);
							manager.off(`shell:close:${input.sessionId}`, onClose);
						};
					},
				);
			}),

		/** List files in a directory on the remote server */
		listFiles: publicProcedure
			.input(z.object({ id: z.string(), path: z.string() }))
			.query(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const result = await manager.exec(
					input.id,
					`ls -1pa ${JSON.stringify(input.path)} 2>/dev/null`,
				);
				if (result.code !== 0) return [];
				return result.stdout
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((name) => ({
						name: name.replace(/\/$/, ""),
						isDirectory: name.endsWith("/"),
					}));
			}),

		createDirectory: publicProcedure
			.input(z.object({ id: z.string(), path: z.string() }))
			.mutation(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const result = await manager.exec(
					input.id,
					`mkdir -p ${JSON.stringify(input.path)} 2>/dev/null`,
				);
				return { success: result.code === 0, error: result.stderr };
			}),

		/** Read a file on the remote server */
		readFile: publicProcedure
			.input(z.object({ id: z.string(), path: z.string() }))
			.query(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const result = await manager.exec(
					input.id,
					`cat ${JSON.stringify(input.path)} 2>/dev/null`,
				);
				if (result.code !== 0) {
					return { content: null, error: result.stderr };
				}
				return { content: result.stdout, error: null };
			}),

		/** Write a file on the remote server */
		writeFile: publicProcedure
			.input(
				z.object({
					id: z.string(),
					path: z.string(),
					content: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const pathLiteral = JSON.stringify(input.path);
				const result = await manager.exec(
					input.id,
					`TARGET=${pathLiteral}; DIR=$(dirname "$TARGET"); mkdir -p "$DIR" && if [ -e "$TARGET" ]; then echo "Path already exists" >&2; exit 1; fi && cat > "$TARGET" << 'SUPERSET_EOF'\n${input.content}\nSUPERSET_EOF`,
				);
				return { success: result.code === 0, error: result.stderr };
			}),

		renamePath: publicProcedure
			.input(
				z.object({
					id: z.string(),
					sourcePath: z.string(),
					destinationPath: z.string(),
				}),
			)
			.mutation(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const destinationParentPath = dirname(input.destinationPath);
				const result = await manager.exec(
					input.id,
					`DEST=${JSON.stringify(input.destinationPath)}; DEST_PARENT=${JSON.stringify(destinationParentPath)}; SRC=${JSON.stringify(input.sourcePath)}; mkdir -p "$DEST_PARENT" && if [ ! -e "$SRC" ]; then echo "Source path does not exist" >&2; exit 1; fi && if [ -e "$DEST" ]; then echo "Destination path already exists" >&2; exit 1; fi && mv "$SRC" "$DEST"`,
				);
				return { success: result.code === 0, error: result.stderr };
			}),

		deletePaths: publicProcedure
			.input(
				z.object({
					id: z.string(),
					paths: z.array(z.string()).min(1),
				}),
			)
			.mutation(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const deleted: string[] = [];
				const failed: Array<{ path: string; error: string }> = [];

				for (const path of input.paths) {
					const result = await manager.exec(
						input.id,
						`TARGET=${JSON.stringify(path)}; if [ ! -e "$TARGET" ]; then echo "Path does not exist" >&2; exit 1; fi && rm -rf "$TARGET"`,
					);

					if (result.code === 0) {
						deleted.push(path);
						continue;
					}

					failed.push({
						path,
						error: result.stderr.trim() || "Delete failed",
					});
				}

				return { deleted, failed };
			}),

		uploadFiles: publicProcedure
			.input(
				z.object({
					id: z.string(),
					targetPath: z.string(),
					localPaths: z.array(z.string()).min(1),
					conflictResolution: z
						.enum(["skip", "overwrite", "rename"])
						.optional(),
					conflictLocalPaths: z.array(z.string()).optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const uploaded: Array<{
					localPath: string;
					fileName: string;
					remotePath: string;
				}> = [];
				const skipped: Array<{ localPath: string; reason: string }> = [];
				const conflicts: Array<{
					localPath: string;
					fileName: string;
					existingPath: string;
					reason: string;
				}> = [];
				const conflictResolution = input.conflictResolution ?? "skip";
				const conflictLocalPathSet = new Set(input.conflictLocalPaths ?? []);

				for (const localPath of input.localPaths) {
					let localStats: Stats;
					try {
						localStats = await stat(localPath);
					} catch (error) {
						skipped.push({
							localPath,
							reason:
								error instanceof Error
									? error.message
									: "Could not read local file",
						});
						continue;
					}

					if (localStats.isDirectory()) {
						skipped.push({
							localPath,
							reason: "Directory uploads are not supported yet",
						});
						continue;
					}

					if (!localStats.isFile()) {
						skipped.push({
							localPath,
							reason: "Only regular files can be uploaded",
						});
						continue;
					}

					const fileName = basename(localPath);
					const baseRemotePath = `${input.targetPath.replace(/\/+$/, "")}/${fileName}`;

					const existsResult = await manager.exec(
						input.id,
						`if [ -e ${JSON.stringify(baseRemotePath)} ]; then exit 0; else exit 1; fi`,
					);

					if (existsResult.code === 0) {
						if (
							conflictResolution === "skip" ||
							(input.conflictLocalPaths && !conflictLocalPathSet.has(localPath))
						) {
							conflicts.push({
								localPath,
								fileName,
								existingPath: baseRemotePath,
								reason: `Remote file already exists: ${fileName}`,
							});
							continue;
						}
					}

					const remotePath =
						existsResult.code === 0 && conflictResolution === "rename"
							? await resolveRenamedRemotePath(
									manager,
									input.id,
									baseRemotePath,
								)
							: baseRemotePath;

					if (existsResult.code === 0 && conflictResolution === "overwrite") {
						const removeResult = await manager.exec(
							input.id,
							`TARGET=${JSON.stringify(baseRemotePath)}; rm -rf "$TARGET"`,
						);

						if (removeResult.code !== 0) {
							skipped.push({
								localPath,
								reason:
									removeResult.stderr.trim() ||
									"Failed to overwrite existing remote file",
							});
							continue;
						}
					}

					try {
						await manager.uploadFile(input.id, localPath, remotePath);
						uploaded.push({ localPath, fileName, remotePath });
					} catch (error) {
						skipped.push({
							localPath,
							reason: error instanceof Error ? error.message : "Upload failed",
						});
					}
				}

				return {
					targetPath: input.targetPath,
					uploaded,
					skipped,
					conflicts,
				};
			}),

		/** Get git status on the remote server */
		gitStatus: publicProcedure
			.input(z.object({ id: z.string(), path: z.string() }))
			.query(async ({ input }) => {
				const manager = getSSHConnectionManager();
				const result = await manager.exec(
					input.id,
					`cd ${JSON.stringify(input.path)} && git status --porcelain 2>/dev/null`,
				);
				if (result.code !== 0) return { files: [], error: result.stderr };
				const files = result.stdout
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((line) => ({
						status: line.slice(0, 2).trim(),
						path: line.slice(3),
					}));
				return { files, error: null };
			}),

		onStatusChange: publicProcedure.subscription(() => {
			return observable<{
				serverId: string;
				status: SelectServer["status"];
				message?: string;
			}>((emit) => {
				const manager = getSSHConnectionManager();

				const handler = (event: {
					serverId: string;
					status: SelectServer["status"];
					message?: string;
				}) => {
					emit.next(event);
				};

				manager.on("statusChange", handler);

				return () => {
					manager.off("statusChange", handler);
				};
			});
		}),

		// ── Server Spaces CRUD ──────────────────────────────────

		listSpaces: publicProcedure
			.input(z.object({ serverId: z.string() }))
			.query(({ input }) => {
				return localDb
					.select()
					.from(serverSpaces)
					.where(eq(serverSpaces.serverId, input.serverId))
					.all();
			}),

		createSpace: publicProcedure
			.input(
				z.object({
					serverId: z.string(),
					label: z.string().min(1),
					directory: z.string().optional(),
				}),
			)
			.mutation(({ input }) => {
				return localDb
					.insert(serverSpaces)
					.values({
						serverId: input.serverId,
						label: input.label,
						directory: resolveSpaceDirectory(input.directory, input.serverId),
					})
					.returning()
					.get();
			}),

		updateSpace: publicProcedure
			.input(
				z.object({
					id: z.string(),
					label: z.string().min(1).optional(),
					directory: z.string().nullable().optional(),
					color: z.string().nullable().optional(),
					sortOrder: z.number().int().optional(),
				}),
			)
			.mutation(({ input }) => {
				const { id, ...updates } = input;
				const currentSpace = localDb
					.select({ serverId: serverSpaces.serverId })
					.from(serverSpaces)
					.where(eq(serverSpaces.id, id))
					.get();
				const directory = currentSpace
					? resolveSpaceDirectory(updates.directory, currentSpace.serverId)
					: null;
				return localDb
					.update(serverSpaces)
					.set({
						...updates,
						directory: "directory" in updates ? directory : undefined,
						updatedAt: Date.now(),
					})
					.where(eq(serverSpaces.id, id))
					.returning()
					.get();
			}),

		deleteSpace: publicProcedure
			.input(z.object({ id: z.string() }))
			.mutation(({ input }) => {
				localDb.delete(serverSpaces).where(eq(serverSpaces.id, input.id)).run();
				return { success: true };
			}),

		listTerminalSessions: publicProcedure
			.input(z.object({ spaceId: z.string() }))
			.query(({ input }) => {
				return localDb
					.select()
					.from(serverTerminalSessions)
					.where(eq(serverTerminalSessions.spaceId, input.spaceId))
					.orderBy(serverTerminalSessions.sortOrder)
					.all();
			}),

		upsertTerminalSession: publicProcedure
			.input(
				z.object({
					serverId: z.string(),
					spaceId: z.string(),
					terminalId: z.string(),
					tmuxSessionName: z.string().min(1),
					label: z.string().nullable().optional(),
					sortOrder: z.number().int().optional(),
					isSelected: z.boolean().optional(),
				}),
			)
			.mutation(({ input }) => {
				const existing = localDb
					.select({ id: serverTerminalSessions.id })
					.from(serverTerminalSessions)
					.where(
						and(
							eq(serverTerminalSessions.spaceId, input.spaceId),
							eq(serverTerminalSessions.terminalId, input.terminalId),
						),
					)
					.get();

				if (input.isSelected) {
					localDb
						.update(serverTerminalSessions)
						.set({ isSelected: false, updatedAt: Date.now() })
						.where(eq(serverTerminalSessions.spaceId, input.spaceId))
						.run();
				}

				const values = {
					serverId: input.serverId,
					spaceId: input.spaceId,
					terminalId: input.terminalId,
					tmuxSessionName: input.tmuxSessionName,
					label: input.label ?? null,
					sortOrder: input.sortOrder ?? 0,
					isSelected: input.isSelected ?? false,
					updatedAt: Date.now(),
				};

				if (existing) {
					return localDb
						.update(serverTerminalSessions)
						.set(values)
						.where(eq(serverTerminalSessions.id, existing.id))
						.returning()
						.get();
				}

				return localDb
					.insert(serverTerminalSessions)
					.values(values)
					.returning()
					.get();
			}),

		deleteTerminalSession: publicProcedure
			.input(z.object({ spaceId: z.string(), terminalId: z.string() }))
			.mutation(({ input }) => {
				localDb
					.delete(serverTerminalSessions)
					.where(
						and(
							eq(serverTerminalSessions.spaceId, input.spaceId),
							eq(serverTerminalSessions.terminalId, input.terminalId),
						),
					)
					.run();
				return { success: true };
			}),

		setSelectedTerminalSession: publicProcedure
			.input(
				z.object({ spaceId: z.string(), terminalId: z.string().nullable() }),
			)
			.mutation(({ input }) => {
				localDb
					.update(serverTerminalSessions)
					.set({ isSelected: false, updatedAt: Date.now() })
					.where(eq(serverTerminalSessions.spaceId, input.spaceId))
					.run();

				if (input.terminalId) {
					localDb
						.update(serverTerminalSessions)
						.set({ isSelected: true, updatedAt: Date.now() })
						.where(
							and(
								eq(serverTerminalSessions.spaceId, input.spaceId),
								eq(serverTerminalSessions.terminalId, input.terminalId),
							),
						)
						.run();
				}

				return { success: true };
			}),
	});
};

/** Shared helper to sync remote worktrees into local DB */
async function syncRemoteWorktrees(
	manager: ReturnType<typeof getSSHConnectionManager>,
	serverId: string,
	project: SelectProject,
) {
	if (!project.remoteRepoPath) return;

	const result = await manager.exec(
		serverId,
		`cd ${JSON.stringify(project.remoteRepoPath)} && git worktree list --porcelain`,
	);
	if (result.code !== 0) return;

	const remoteWts: Array<{ path: string; branch: string }> = [];
	let current: Record<string, string> = {};

	for (const line of result.stdout.split("\n")) {
		if (line === "") {
			if (current.worktree) {
				remoteWts.push({
					path: current.worktree,
					branch: current.branch?.replace("refs/heads/", "") ?? "detached",
				});
			}
			current = {};
		} else {
			const spaceIdx = line.indexOf(" ");
			if (spaceIdx !== -1) {
				current[line.slice(0, spaceIdx)] = line.slice(spaceIdx + 1);
			} else {
				current[line] = "true";
			}
		}
	}
	if (current.worktree) {
		remoteWts.push({
			path: current.worktree,
			branch: current.branch?.replace("refs/heads/", "") ?? "detached",
		});
	}

	const existingPaths = new Set(
		localDb
			.select()
			.from(worktrees)
			.where(eq(worktrees.projectId, project.id))
			.all()
			.map((w) => w.path),
	);

	let maxTab = Math.max(
		0,
		...localDb
			.select()
			.from(workspaces)
			.where(eq(workspaces.projectId, project.id))
			.all()
			.map((w) => w.tabOrder),
	);

	for (const rwt of remoteWts) {
		if (existingPaths.has(rwt.path)) continue;

		const isMain = rwt.path === project.remoteRepoPath;
		const wt = localDb
			.insert(worktrees)
			.values({
				projectId: project.id,
				path: rwt.path,
				branch: rwt.branch,
				createdBySuperset: false,
			})
			.returning()
			.get();

		maxTab += 1;
		localDb
			.insert(workspaces)
			.values({
				projectId: project.id,
				worktreeId: wt.id,
				type: isMain ? "branch" : "worktree",
				branch: rwt.branch,
				name: isMain ? "local" : rwt.branch,
				tabOrder: maxTab,
			})
			.run();
	}
}
