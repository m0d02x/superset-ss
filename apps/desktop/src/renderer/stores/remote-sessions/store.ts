import { electronTrpcClient } from "renderer/lib/trpc-client";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { clearRemoteTerminalSnapshot } from "./view-state";

const DEFAULT_REMOTE_TERMINAL_COLS = 120;
const DEFAULT_REMOTE_TERMINAL_ROWS = 30;

export type RemoteSessionStatus =
	| "idle"
	| "opening"
	| "open"
	| "detached"
	| "error";

export interface RemoteSessionEntry {
	key: string;
	serverId: string;
	sessionId: string | null;
	status: RemoteSessionStatus;
	attachedViews: number;
	generation: number;
	inFlightOpen: Promise<string> | null;
	closeTimer: ReturnType<typeof setTimeout> | null;
	errorMessage: string | null;
	cwd?: string;
	/** tmux session the shell attaches to; reused when reconnecting. */
	tmuxSession?: string;
}

interface AcquireRemoteSessionOptions {
	key: string;
	serverId: string;
	cwd?: string;
	tmuxSession?: string;
}

interface RemoteSessionsState {
	sessions: Record<string, RemoteSessionEntry>;
	acquireSession: (options: AcquireRemoteSessionOptions) => Promise<string>;
	reconnectSession: (options: AcquireRemoteSessionOptions) => Promise<string>;
	/** Reopen a session's shell with the options it was opened with. */
	reconnectSessionByKey: (key: string) => Promise<string>;
	releaseSession: (key: string) => void;
	destroySession: (key: string) => void;
	markSessionClosed: (key: string, sessionId: string) => void;
	clearAllSessions: () => void;
}

function buildSessionKeyParts(serverId: string, terminalId: string): string {
	return `${serverId}:${terminalId}`;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function buildRemoteSessionKey(params: {
	serverId: string;
	terminalId: string;
	workspaceId?: string;
}): string {
	const terminalId = params.workspaceId
		? `${params.workspaceId}:${params.terminalId}`
		: params.terminalId;
	return buildSessionKeyParts(params.serverId, terminalId);
}

export const useRemoteSessionsStore = create<RemoteSessionsState>()(
	devtools(
		(set, get) => {
			const closeShell = (sessionId: string, killTmux = true): void => {
				electronTrpcClient.servers.closeShell
					.mutate({ sessionId, killTmux })
					.catch((error) => {
						console.warn("[remote-sessions] failed to close shell", {
							sessionId,
							error: getErrorMessage(error),
						});
					});
			};

			const setEntry = (
				key: string,
				updater: (
					entry: RemoteSessionEntry | null,
				) => RemoteSessionEntry | null,
			): void => {
				set((state) => {
					const current = state.sessions[key] ?? null;
					const next = updater(current);
					const sessions = { ...state.sessions };
					if (next) {
						sessions[key] = next;
					} else {
						delete sessions[key];
					}
					return { sessions };
				});
			};

			const beginOpenSession = (
				options: AcquireRemoteSessionOptions,
				entry: RemoteSessionEntry | null,
				generation: number,
				attachedViews: number,
			): Promise<string> => {
				let openPromise: Promise<string>;

				openPromise = electronTrpcClient.servers.openShell
					.mutate({
						serverId: options.serverId,
						cols: DEFAULT_REMOTE_TERMINAL_COLS,
						rows: DEFAULT_REMOTE_TERMINAL_ROWS,
						cwd: options.cwd,
						tmuxSession: options.tmuxSession,
					})
					.then(({ sessionId }) => {
						const current = get().sessions[options.key];
						if (
							!current ||
							current.generation !== generation ||
							current.inFlightOpen !== openPromise
						) {
							closeShell(sessionId);
							return sessionId;
						}

						if (current.attachedViews === 0) {
							setEntry(options.key, () => null);
							closeShell(sessionId);
							return sessionId;
						}

						setEntry(options.key, (existing) => {
							if (
								!existing ||
								existing.generation !== generation ||
								existing.inFlightOpen !== openPromise
							) {
								return existing;
							}

							return {
								...existing,
								sessionId,
								status: "open",
								inFlightOpen: null,
								errorMessage: null,
								cwd: existing.cwd ?? options.cwd,
							};
						});

						return sessionId;
					})
					.catch((error) => {
						const errorMessage = getErrorMessage(error);
						setEntry(options.key, (current) => {
							if (
								!current ||
								current.generation !== generation ||
								current.inFlightOpen !== openPromise
							) {
								return current;
							}

							if (current.attachedViews === 0) {
								return null;
							}

							return {
								...current,
								status: "error",
								inFlightOpen: null,
								errorMessage,
								sessionId: null,
							};
						});
						throw error;
					});

				setEntry(options.key, () => ({
					key: options.key,
					serverId: options.serverId,
					sessionId: null,
					status: "opening",
					attachedViews,
					generation,
					inFlightOpen: openPromise,
					closeTimer: null,
					errorMessage: null,
					cwd: entry?.cwd ?? options.cwd,
					tmuxSession: options.tmuxSession ?? entry?.tmuxSession,
				}));

				return openPromise;
			};

			return {
				sessions: {},

				acquireSession: async (options) => {
					const existing = get().sessions[options.key] ?? null;
					const attachedViews = (existing?.attachedViews ?? 0) + 1;

					if (existing?.closeTimer) {
						clearTimeout(existing.closeTimer);
					}

					if (existing?.sessionId) {
						setEntry(options.key, (current) => {
							if (!current) {
								return current;
							}
							return {
								...current,
								attachedViews,
								status: "open",
								closeTimer: null,
								errorMessage: null,
								serverId: options.serverId,
								cwd: current.cwd ?? options.cwd,
							};
						});
						return existing.sessionId;
					}

					if (existing?.inFlightOpen) {
						setEntry(options.key, (current) => {
							if (!current) {
								return current;
							}
							return {
								...current,
								attachedViews,
								closeTimer: null,
								serverId: options.serverId,
								cwd: current.cwd ?? options.cwd,
							};
						});
						return existing.inFlightOpen;
					}

					return beginOpenSession(
						options,
						existing,
						existing?.generation ?? 0,
						attachedViews,
					);
				},

				reconnectSession: async (options) => {
					const existing = get().sessions[options.key] ?? null;
					if ((existing?.attachedViews ?? 0) === 0) {
						throw new Error(
							"Cannot reconnect a remote session without an attached terminal view",
						);
					}
					if (existing?.closeTimer) {
						clearTimeout(existing.closeTimer);
					}
					if (existing?.sessionId) {
						// Don't kill tmux on reconnect — we want to reattach
						closeShell(existing.sessionId, false);
					}

					return beginOpenSession(
						options,
						existing,
						(existing?.generation ?? 0) + 1,
						existing.attachedViews,
					);
				},

				reconnectSessionByKey: (key) => {
					const existing = get().sessions[key];
					if (!existing) {
						return Promise.reject(
							new Error(`No remote session to reconnect for ${key}`),
						);
					}
					// The old shell's scrollback is stale once tmux is reattached.
					clearRemoteTerminalSnapshot(key);
					return get().reconnectSession({
						key,
						serverId: existing.serverId,
						cwd: existing.cwd,
						tmuxSession: existing.tmuxSession,
					});
				},

				releaseSession: (key) => {
					const entry = get().sessions[key];
					if (!entry) {
						return;
					}

					const attachedViews = Math.max(entry.attachedViews - 1, 0);
					if (attachedViews > 0) {
						setEntry(key, (current) => {
							if (!current) {
								return current;
							}
							return {
								...current,
								attachedViews,
							};
						});
						return;
					}

					setEntry(key, (current) => {
						if (!current) {
							return current;
						}
						if (current.closeTimer) {
							clearTimeout(current.closeTimer);
						}
						return {
							...current,
							attachedViews: 0,
							closeTimer: null,
							status: current.sessionId ? "detached" : current.status,
						};
					});
				},

				destroySession: (key) => {
					const entry = get().sessions[key];
					if (!entry) {
						return;
					}
					if (entry.closeTimer) {
						clearTimeout(entry.closeTimer);
					}
					setEntry(key, () => null);
					if (entry.sessionId) {
						closeShell(entry.sessionId);
					}
				},

				markSessionClosed: (key, sessionId) => {
					setEntry(key, (current) => {
						if (!current || current.sessionId !== sessionId) {
							return current;
						}
						if (current.closeTimer) {
							clearTimeout(current.closeTimer);
						}
						if (current.attachedViews === 0) {
							return null;
						}
						return {
							...current,
							sessionId: null,
							status: current.attachedViews > 0 ? "error" : "idle",
							closeTimer: null,
							inFlightOpen: null,
							errorMessage: null,
						};
					});
				},

				clearAllSessions: () => {
					const sessions = Object.values(get().sessions);
					for (const entry of sessions) {
						if (entry.closeTimer) {
							clearTimeout(entry.closeTimer);
						}
						if (entry.sessionId) {
							closeShell(entry.sessionId);
						}
					}
					set({ sessions: {} });
				},
			};
		},
		{ name: "remote-sessions-store" },
	),
);
