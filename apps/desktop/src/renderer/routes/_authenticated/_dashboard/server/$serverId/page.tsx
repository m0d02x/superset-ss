import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Plus, RotateCw, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuPanelRight } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useAppHotkey } from "renderer/stores/hotkeys";
import {
	buildRemoteSessionKey,
	useRemoteSessionsStore,
} from "renderer/stores/remote-sessions";
import {
	type ServerTerminal,
	useServersStore,
} from "renderer/stores/servers-state";
import { buildRestoredServerTerminals } from "shared/server-terminal-sessions";
import { getSpaceDisplayLabels } from "shared/space-display";
import { normalizeTerminalTitle } from "shared/terminal-title";
import { HYPERSET_SESSION_PREFIX, HYPERSET_TMUX } from "shared/tmux";
import { GhosttySSHTerminal } from "./components/GhosttySSHTerminal";
import { RemoteTerminalTab } from "./components/RemoteTerminalTab";
import { SSHTerminal } from "./components/SSHTerminal";
import { RemoteFileViewer } from "./workspace/$workspaceId/components/RemoteFileViewer";

/**
 * Dev toggle: set localStorage.setItem('USE_GHOSTTY', '1') to use ghostty-web
 * instead of xterm.js for SSH terminals.
 */
function useGhosttyEnabled(): boolean {
	// Disabled: ghostty-web 0.4.0 crashes (WASM unreachable trap) on macOS
	// space/tab switches because its internal requestAnimationFrame render loop
	// calls into WASM while the canvas is in an invalid state. Re-enable once
	// ghostty-web handles visibility changes gracefully.
	return false;
}

import { ServerWorkspaceSidebar } from "./workspace/$workspaceId/components/ServerWorkspaceSidebar";

interface ServerSearchParams {
	space?: string;
	tab?: string;
}

interface TmuxSessionInfo {
	name: string;
	title: string;
	attached: boolean;
}

export const Route = createFileRoute(
	"/_authenticated/_dashboard/server/$serverId/",
)({
	component: ServerPage,
	validateSearch: (search: Record<string, unknown>): ServerSearchParams => ({
		space: typeof search.space === "string" ? search.space : undefined,
		tab: typeof search.tab === "string" ? search.tab : undefined,
	}),
});

function ServerPage() {
	const { serverId } = Route.useParams();
	const { space: spaceId, tab: tabParam } = Route.useSearch();
	const navigate = Route.useNavigate();
	const utils = electronTrpc.useUtils();
	const { data: server } = electronTrpc.servers.get.useQuery(
		{ id: serverId },
		{ refetchInterval: 2000 },
	);

	electronTrpc.servers.onStatusChange.useSubscription(undefined, {
		onData: (event) => {
			if (event.serverId !== serverId) {
				return;
			}

			utils.servers.get.invalidate({ id: serverId });
			utils.servers.list.invalidate();
		},
	});

	const { data: spaces = [] } = electronTrpc.servers.listSpaces.useQuery(
		{ serverId },
		{ refetchOnWindowFocus: false },
	);
	const { data: persistedTerminalSessions = [] } =
		electronTrpc.servers.listTerminalSessions.useQuery(
			{ spaceId: spaceId ?? "" },
			{ enabled: !!spaceId, refetchOnWindowFocus: false },
		);
	// `useMutation()` returns a fresh object on every render (its result spread is
	// rebuilt each time), while `.mutate` is stable. Effects/callbacks must depend
	// on `.mutate` only — depending on the mutation object makes any mutation state
	// change re-fire the effect, which mutates again → infinite update loop.
	const upsertTerminalSession =
		electronTrpc.servers.upsertTerminalSession.useMutation().mutate;
	const deleteTerminalSession =
		electronTrpc.servers.deleteTerminalSession.useMutation().mutate;
	const setSelectedTerminalSession =
		electronTrpc.servers.setSelectedTerminalSession.useMutation().mutate;
	const destroySession = useRemoteSessionsStore(
		(state) => state.destroySession,
	);

	const {
		spaceTerminals,
		addTerminalToSpace,
		removeTerminalFromSpace,
		setSelectedServer,
		setSelectedSpace,
		getSelectedTerminalForSpace,
		setSelectedTerminalForSpace,
		terminalCwds,
		setTerminalCwd,
		setTerminalLabel,
		restoreTerminalsForSpace,
	} = useServersStore();

	const execMutation = electronTrpc.servers.exec.useMutation();
	const execServerCommand = execMutation.mutateAsync;
	const restoredSpacesRef = useRef<Set<string>>(new Set());
	// Terminals whose tab label came from an agent session title (omp, Claude…).
	// Agent titles stick: a later shell prompt title must not overwrite them.
	const agentTitledRef = useRef<Set<string>>(new Set());

	// Restore tabs from existing tmux sessions on the server
	useEffect(() => {
		if (!spaceId || server?.status !== "connected") return;
		if (restoredSpacesRef.current.has(spaceId)) return;
		restoredSpacesRef.current.add(spaceId);

		if (persistedTerminalSessions.length > 0) {
			const restored = buildRestoredServerTerminals({
				spaceId,
				persisted: persistedTerminalSessions,
				discovered: [],
			});
			tmuxOverridesRef.current = new Map(restored.tmuxOverrides);
			restoreTerminalsForSpace(
				spaceId,
				restored.terminals.map((terminal) => terminal.id),
				Object.fromEntries(
					restored.terminals.map((terminal) => [terminal.id, terminal.label]),
				),
				restored.selectedTerminalId,
			);
			// Saved labels without a path separator came from an agent title
			// (shell titles look like `dev/claix-dev`); keep them sticky.
			// Default "Terminal N" labels are not session titles.
			for (const terminal of restored.terminals) {
				if (
					!terminal.label.includes("/") &&
					!/^Terminal \d+$/.test(terminal.label)
				) {
					agentTitledRef.current.add(terminal.id);
				}
			}
			return;
		}

		const prefix = `ss-${spaceId}-term-`;
		execServerCommand({
			id: serverId,
			command: `${HYPERSET_TMUX} list-sessions -F '#{session_name}:#{session_activity}:#{pane_title}' 2>/dev/null || true`,
		})
			.then((result) => {
				if (result.code !== 0 || !result.stdout.trim()) return;

				const allLines = result.stdout
					.split("\n")
					.map((s) => s.trim())
					.filter((s) => s.startsWith(prefix));

				if (allLines.length === 0) return;

				const allSessions = allLines.map((s) => {
					const firstColon = s.indexOf(":", prefix.length);
					const secondColon = s.indexOf(":", firstColon + 1);
					const sessionName = firstColon >= 0 ? s.slice(0, firstColon) : s;
					const activity =
						firstColon >= 0 && secondColon >= 0
							? Number.parseInt(s.slice(firstColon + 1, secondColon), 10)
							: 0;
					const paneTitle =
						secondColon >= 0 ? s.slice(secondColon + 1).trim() : "";
					const id = sessionName.slice(`ss-${spaceId}-`.length);
					return { id, sessionName, activity, paneTitle };
				});

				// Sort by activity (most recent first), keep top 5, kill the rest
				const MAX_RESTORED_TABS = 5;
				allSessions.sort((a, b) => b.activity - a.activity);
				const toRestore = allSessions.slice(0, MAX_RESTORED_TABS);
				const toKill = allSessions.slice(MAX_RESTORED_TABS);

				if (toKill.length > 0) {
					const killCmd = toKill
						.map((s) => `${HYPERSET_TMUX} kill-session -t '${s.sessionName}'`)
						.join(" ; ");
					execServerCommand({
						id: serverId,
						command: `${killCmd} 2>/dev/null || true`,
					});
				}

				const restored = buildRestoredServerTerminals({
					spaceId,
					persisted: [],
					discovered: toRestore.map(({ id, paneTitle }) => ({
						terminalId: id,
						label: paneTitle ? normalizeTerminalTitle(paneTitle).label : null,
					})),
				});
				restoreTerminalsForSpace(
					spaceId,
					restored.terminals.map((terminal) => terminal.id),
					Object.fromEntries(
						restored.terminals.map((terminal) => [terminal.id, terminal.label]),
					),
					restored.selectedTerminalId,
				);

				// Apply tmux pane titles to restored tabs
				for (const { id, paneTitle } of toRestore) {
					const title = normalizeTerminalTitle(paneTitle);
					if (title.kind === "empty") continue;
					setTerminalLabel(spaceId, id, title.label);
					if (title.kind === "agent") agentTitledRef.current.add(id);
				}
			})
			.catch(() => {
				// Allow a retry on the next connected render (reconnect race)
				restoredSpacesRef.current.delete(spaceId);
			});
	}, [
		execServerCommand,
		persistedTerminalSessions,
		restoreTerminalsForSpace,
		server,
		serverId,
		setTerminalLabel,
		spaceId,
	]);

	useEffect(() => {
		setSelectedSpace(spaceId || null);
		return () => {
			setSelectedSpace(null);
		};
	}, [setSelectedSpace, spaceId]);

	const activeSpace = useMemo(() => {
		return spaces.find((s) => s.id === spaceId) || null;
	}, [spaces, spaceId]);
	// Same label the sidebar shows (folder name for unnamed spaces).
	const activeSpaceLabel = useMemo(
		() =>
			(spaceId && getSpaceDisplayLabels(spaces).get(spaceId)) ||
			activeSpace?.label,
		[spaces, spaceId, activeSpace],
	);

	const tabs = useMemo(() => {
		if (!spaceId) return [];
		return spaceTerminals[spaceId] || [];
	}, [spaceId, spaceTerminals]);

	// All terminals across all spaces — kept mounted to preserve scrollback
	const allTerminals = useMemo(() => {
		const result: Array<{ spaceId: string; terminal: ServerTerminal }> = [];
		for (const [sid, terms] of Object.entries(spaceTerminals)) {
			for (const t of terms) {
				result.push({ spaceId: sid, terminal: t });
			}
		}
		return result;
	}, [spaceTerminals]);

	const activeTabId = useMemo(() => {
		if (!spaceId) return null;

		if (tabParam && tabs.some((t) => t.id === tabParam)) {
			return tabParam;
		}

		const rememberedTabId = getSelectedTerminalForSpace(spaceId);
		if (rememberedTabId && tabs.some((t) => t.id === rememberedTabId)) {
			return rememberedTabId;
		}

		return tabs[0]?.id || null;
	}, [getSelectedTerminalForSpace, spaceId, tabParam, tabs]);

	const persistTerminalLabel = useCallback(
		(sid: string, terminalId: string, label: string) => {
			upsertTerminalSession({
				serverId,
				spaceId: sid,
				terminalId,
				tmuxSessionName:
					tmuxOverridesRef.current.get(`${sid}:${terminalId}`) ??
					`ss-${sid}-${terminalId}`,
				label,
				sortOrder:
					spaceTerminals[sid]?.findIndex(
						(terminal) => terminal.id === terminalId,
					) ?? 0,
				isSelected: activeTabId === terminalId,
			});
		},
		[activeTabId, serverId, spaceTerminals, upsertTerminalSession],
	);

	useEffect(() => {
		if (!spaceId) {
			return;
		}

		setSelectedTerminalForSpace(spaceId, activeTabId);
		setSelectedTerminalSession({ spaceId, terminalId: activeTabId });
	}, [
		activeTabId,
		setSelectedTerminalForSpace,
		setSelectedTerminalSession,
		spaceId,
	]);

	useEffect(() => {
		setSelectedServer(serverId);
		return () => setSelectedServer(null);
	}, [serverId, setSelectedServer]);

	const handleAddTerminal = useCallback(() => {
		if (!spaceId || !activeSpace) {
			return;
		}

		const inheritedCwd =
			activeSpace.directory ||
			(activeTabId ? terminalCwds[activeTabId] : undefined);

		const terminal = addTerminalToSpace(spaceId);
		if (inheritedCwd) {
			setTerminalCwd(terminal.id, inheritedCwd);
		}
		upsertTerminalSession({
			serverId,
			spaceId,
			terminalId: terminal.id,
			tmuxSessionName: `ss-${spaceId}-${terminal.id}`,
			label: terminal.label,
			sortOrder: tabs.length,
			isSelected: true,
		});
		navigate({
			search: { space: spaceId, tab: terminal.id },
		});
	}, [
		activeSpace,
		activeTabId,
		addTerminalToSpace,
		navigate,
		serverId,
		setTerminalCwd,
		spaceId,
		tabs.length,
		terminalCwds,
		upsertTerminalSession,
	]);

	// Tmux session discovery for "Attach" dropdown
	const [tmuxSessions, setTmuxSessions] = useState<TmuxSessionInfo[]>([]);
	const [tmuxDropdownOpen, setTmuxDropdownOpen] = useState(false);

	// Fetch tmux sessions when dropdown opens — scoped to current space
	useEffect(() => {
		if (!tmuxDropdownOpen || !spaceId || server?.status !== "connected") return;

		execServerCommand({
			id: serverId,
			command:
				"tmux list-sessions -F '#{session_name}:#{session_attached}:#{pane_title}' 2>/dev/null || true",
		}).then((result) => {
			if (result.code !== 0 || !result.stdout.trim()) {
				setTmuxSessions([]);
				return;
			}

			const sessions = result.stdout
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => {
					const firstColon = line.indexOf(":");
					const secondColon = line.indexOf(":", firstColon + 1);
					const name = line.slice(0, firstColon);
					const attached = line.slice(firstColon + 1, secondColon) === "1";
					const title = line.slice(secondColon + 1).trim();
					return { name, title, attached };
				})
				.filter((s) => {
					// Only show non-Hyperset sessions (manually created tmux).
					// These live on the user's default tmux socket, so this
					// query intentionally does NOT use HYPERSET_TMUX.
					return !s.name.startsWith(HYPERSET_SESSION_PREFIX);
				});

			setTmuxSessions(sessions);
		});
	}, [execServerCommand, server, serverId, spaceId, tmuxDropdownOpen]);

	const handleAttachTmux = useCallback(
		(sessionName: string, sessionTitle: string) => {
			if (!spaceId) return;

			const terminal = addTerminalToSpace(spaceId);
			if (sessionTitle) {
				setTerminalLabel(spaceId, terminal.id, sessionTitle);
				agentTitledRef.current.add(terminal.id);
			}
			// Override the tmux session name for this terminal
			// We store it so acquireSession uses the external session name
			tmuxOverridesRef.current.set(`${spaceId}:${terminal.id}`, sessionName);
			upsertTerminalSession({
				serverId,
				spaceId,
				terminalId: terminal.id,
				tmuxSessionName: sessionName,
				label: sessionTitle || terminal.label,
				sortOrder: tabs.length,
				isSelected: true,
			});
			navigate({
				search: { space: spaceId, tab: terminal.id },
			});
		},
		[
			addTerminalToSpace,
			navigate,
			serverId,
			setTerminalLabel,
			spaceId,
			tabs.length,
			upsertTerminalSession,
		],
	);

	const tmuxOverridesRef = useRef<Map<string, string>>(new Map());

	const [isSidebarOpen, setIsSidebarOpen] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState(280);
	const [openFilePath, setOpenFilePath] = useState<string | null>(null);

	const handleResizeMouseDown = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = sidebarWidth;
			const onMouseMove = (ev: MouseEvent) => {
				const delta = startX - ev.clientX;
				setSidebarWidth(Math.min(500, Math.max(200, startWidth + delta)));
			};
			const onMouseUp = () => {
				window.removeEventListener("mousemove", onMouseMove);
				window.removeEventListener("mouseup", onMouseUp);
			};
			window.addEventListener("mousemove", onMouseMove);
			window.addEventListener("mouseup", onMouseUp);
		},
		[sidebarWidth],
	);

	const handleFileSelect = useCallback((filePath: string) => {
		setOpenFilePath(filePath);
	}, []);

	const handleCloseTab = useCallback(
		(terminalId: string) => {
			if (!spaceId) {
				return;
			}

			destroySession(
				buildRemoteSessionKey({
					serverId,
					terminalId,
				}),
			);

			const wasActive = activeTabId === terminalId;
			tmuxOverridesRef.current.delete(`${spaceId}:${terminalId}`);
			deleteTerminalSession({ spaceId, terminalId });
			removeTerminalFromSpace(spaceId, terminalId);

			if (wasActive) {
				const remainingTabs = tabs.filter((t) => t.id !== terminalId);
				const newActiveId = remainingTabs[0]?.id;
				setSelectedTerminalForSpace(spaceId, newActiveId ?? null);
				if (newActiveId) {
					navigate({ search: { space: spaceId, tab: newActiveId } });
				} else {
					navigate({ search: { space: spaceId } });
				}
			}
		},
		[
			activeTabId,
			deleteTerminalSession,
			destroySession,
			navigate,
			removeTerminalFromSpace,
			serverId,
			setSelectedTerminalForSpace,
			spaceId,
			tabs,
		],
	);

	const switchToTerminal = useCallback(
		(index: number) => {
			if (!spaceId) {
				return;
			}

			const terminal = tabs[index];
			if (!terminal) {
				return;
			}

			setSelectedTerminalForSpace(spaceId, terminal.id);
			navigate({ search: { space: spaceId, tab: terminal.id } });
		},
		[navigate, setSelectedTerminalForSpace, spaceId, tabs],
	);

	useAppHotkey(
		"NEW_GROUP",
		() => {
			handleAddTerminal();
		},
		{ preventDefault: true },
	);
	useAppHotkey(
		"CLOSE_TERMINAL",
		() => {
			if (activeTabId) {
				handleCloseTab(activeTabId);
			}
		},
		{ preventDefault: true },
		[activeTabId, handleCloseTab],
	);
	useAppHotkey(
		"TOGGLE_SIDEBAR",
		() => {
			setIsSidebarOpen((v) => !v);
		},
		{ preventDefault: true },
		[setIsSidebarOpen],
	);
	useAppHotkey(
		"JUMP_TO_TAB_1",
		() => {
			switchToTerminal(0);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);
	useAppHotkey(
		"JUMP_TO_TAB_2",
		() => {
			switchToTerminal(1);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);
	useAppHotkey(
		"JUMP_TO_TAB_3",
		() => {
			switchToTerminal(2);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);
	useAppHotkey(
		"JUMP_TO_TAB_4",
		() => {
			switchToTerminal(3);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);
	useAppHotkey(
		"JUMP_TO_TAB_5",
		() => {
			switchToTerminal(4);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);
	useAppHotkey(
		"JUMP_TO_TAB_6",
		() => {
			switchToTerminal(5);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);
	useAppHotkey(
		"JUMP_TO_TAB_7",
		() => {
			switchToTerminal(6);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);
	useAppHotkey(
		"JUMP_TO_TAB_8",
		() => {
			switchToTerminal(7);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);
	useAppHotkey(
		"JUMP_TO_TAB_9",
		() => {
			switchToTerminal(8);
		},
		{ preventDefault: true },
		[switchToTerminal],
	);

	const useGhostty = useGhosttyEnabled();
	const TerminalComponent = useGhostty ? GhosttySSHTerminal : SSHTerminal;
	const activeTerminal = useMemo(() => {
		if (!activeTabId) {
			return null;
		}

		return tabs.find((terminal) => terminal.id === activeTabId) ?? null;
	}, [activeTabId, tabs]);

	const reconnectSessionByKey = useRemoteSessionsStore(
		(state) => state.reconnectSessionByKey,
	);
	const handleReconnectActiveTerminal = useCallback(() => {
		if (!activeTabId) return;
		reconnectSessionByKey(
			buildRemoteSessionKey({ serverId, terminalId: activeTabId }),
		).catch((error: unknown) => {
			console.warn("[ServerPage] reconnect failed", error);
		});
	}, [activeTabId, reconnectSessionByKey, serverId]);

	if (!server) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Server not found
			</div>
		);
	}

	if (!spaceId || !activeSpace) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Select a space from the sidebar
			</div>
		);
	}

	if (server.status === "connecting") {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Connecting to {server.label}...
			</div>
		);
	}

	if (server.status !== "connected") {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
				<p className="text-sm font-medium">{server.label}</p>
				<p className="text-xs">
					{server.status === "error"
						? `Error: ${server.statusMessage}`
						: "Not connected"}
				</p>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full overflow-hidden">
			<div className="flex flex-1 min-w-0 flex-col overflow-hidden">
				<div className="flex shrink-0 items-center border-b border-border bg-muted/30 h-10">
					<div className="flex h-full flex-1 items-center overflow-x-auto hide-scrollbar">
						{tabs.map((tab) => (
							<RemoteTerminalTab
								key={tab.id}
								label={tab.label}
								isActive={activeTabId === tab.id}
								sessionKey={buildRemoteSessionKey({
									serverId,
									terminalId: tab.id,
								})}
								onSelect={() => {
									navigate({ search: { space: spaceId, tab: tab.id } });
								}}
								onClose={() => handleCloseTab(tab.id)}
							/>
						))}
					</div>

					<div className="flex shrink-0 items-center gap-0.5 px-2">
						<DropdownMenu
							open={tmuxDropdownOpen}
							onOpenChange={setTmuxDropdownOpen}
						>
							<div className="flex items-center">
								<Button
									variant="ghost"
									size="icon"
									className="size-6 rounded-r-none"
									onClick={handleAddTerminal}
									title="New Terminal"
								>
									<Plus className="size-3.5" />
								</Button>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="size-6 w-4 rounded-l-none px-0"
										title="More options"
									>
										<ChevronDown className="size-2.5" />
									</Button>
								</DropdownMenuTrigger>
							</div>
							<DropdownMenuContent align="start" className="min-w-56">
								<DropdownMenuItem onClick={handleAddTerminal}>
									<Plus className="size-3.5 mr-2" />
									New Terminal
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={!activeTabId}
									onClick={handleReconnectActiveTerminal}
								>
									<RotateCw className="size-3.5 mr-2" />
									Reconnect Shell
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
									Attach tmux session
								</DropdownMenuLabel>
								{tmuxSessions.length === 0 ? (
									<DropdownMenuItem disabled>
										<span className="text-muted-foreground text-xs">
											No external sessions found
										</span>
									</DropdownMenuItem>
								) : (
									tmuxSessions.map((session) => (
										<DropdownMenuItem
											key={session.name}
											onClick={() =>
												handleAttachTmux(
													session.name,
													session.title || session.name,
												)
											}
										>
											<Terminal className="size-3.5 mr-2 shrink-0" />
											<div className="flex flex-col min-w-0">
												<span className="text-xs truncate">
													{session.title || session.name}
												</span>
												<span className="text-[10px] text-muted-foreground truncate">
													{session.name}
													{session.attached ? " · attached" : ""}
												</span>
											</div>
										</DropdownMenuItem>
									))
								)}
							</DropdownMenuContent>
						</DropdownMenu>
						<Button
							variant="ghost"
							size="icon"
							className="size-6"
							onClick={() => setIsSidebarOpen((v) => !v)}
							title="Toggle sidebar"
						>
							<LuPanelRight className="size-3.5" />
						</Button>
					</div>

					<div className="flex shrink-0 items-center gap-2 border-l border-border px-3">
						<div className="size-1.5 rounded-full bg-emerald-500" />
						<span className="text-[10px] text-muted-foreground">
							{activeSpaceLabel} · {server.label}
						</span>
					</div>
				</div>

				<div className="flex flex-1 min-h-0">
					<div className="relative flex-1 min-w-0">
						{allTerminals.map(({ spaceId: sid, terminal: tab }) => {
							const isVisible =
								sid === spaceId && tab.id === activeTerminal?.id;
							return (
								<div
									key={`${sid}:${tab.id}`}
									className="absolute inset-0"
									style={{
										visibility: isVisible ? "visible" : "hidden",
										pointerEvents: isVisible ? "auto" : "none",
									}}
								>
									<TerminalComponent
										serverId={serverId}
										terminalId={tab.id}
										spaceId={sid}
										cwd={terminalCwds[tab.id]}
										isActive={isVisible}
										tmuxSession={tmuxOverridesRef.current.get(
											`${sid}:${tab.id}`,
										)}
										onCwdChange={(cwd) => {
											setTerminalCwd(tab.id, cwd);
										}}
										onTitleChange={(rawTitle) => {
											const title = normalizeTerminalTitle(rawTitle);
											if (title.kind === "empty") return;
											if (title.kind === "agent") {
												agentTitledRef.current.add(tab.id);
											} else if (agentTitledRef.current.has(tab.id)) {
												// Agent exited back to the shell: keep its session name.
												return;
											}
											if (title.label === tab.label) return;
											setTerminalLabel(sid, tab.id, title.label);
											persistTerminalLabel(sid, tab.id, title.label);
										}}
									/>
								</div>
							);
						})}
					</div>

					{openFilePath && (
						<div
							className="shrink-0 border-l border-border flex flex-col"
							style={{ width: "50%" }}
						>
							<RemoteFileViewer
								serverId={serverId}
								filePath={openFilePath}
								onClose={() => setOpenFilePath(null)}
							/>
						</div>
					)}
				</div>
			</div>

			{isSidebarOpen && (
				<div
					style={{ width: sidebarWidth }}
					className="relative shrink-0 border-l border-border flex flex-col h-full"
				>
					<hr
						aria-orientation="vertical"
						aria-valuenow={sidebarWidth}
						aria-valuemin={200}
						aria-valuemax={500}
						tabIndex={0}
						className="absolute left-0 top-0 bottom-0 w-1 h-full border-none cursor-col-resize hover:bg-primary/20 transition-colors z-10"
						onMouseDown={handleResizeMouseDown}
					/>
					<ServerWorkspaceSidebar
						serverId={serverId}
						rootPath={activeSpace.directory ?? undefined}
						onFileSelect={handleFileSelect}
					/>
				</div>
			)}
		</div>
	);
}
