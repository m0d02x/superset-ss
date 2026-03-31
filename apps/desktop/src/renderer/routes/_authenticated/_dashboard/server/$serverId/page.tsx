import { Button } from "@superset/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuPanelRight } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useAppHotkey } from "renderer/stores/hotkeys";
import { useServersStore } from "renderer/stores/servers-state";
import { GhosttySSHTerminal } from "./components/GhosttySSHTerminal";
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
	const { data: server } = electronTrpc.servers.get.useQuery(
		{ id: serverId },
		{ refetchInterval: 2000 },
	);

	const { data: spaces = [] } = electronTrpc.servers.listSpaces.useQuery(
		{ serverId },
		{ refetchOnWindowFocus: false },
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
	const restoredSpacesRef = useRef<Set<string>>(new Set());

	// Restore tabs from existing tmux sessions on the server
	useEffect(() => {
		if (!spaceId || !server || server.status !== "connected") return;
		if (restoredSpacesRef.current.has(spaceId)) return;
		restoredSpacesRef.current.add(spaceId);

		const prefix = `ss-${spaceId}-term-`;
		execMutation
			.mutateAsync({
				id: serverId,
				command:
					"tmux list-sessions -F '#{session_name}' 2>/dev/null || true",
			})
			.then((result) => {
				if (result.code !== 0 || !result.stdout.trim()) return;

				const existingIds = result.stdout
					.split("\n")
					.map((s) => s.trim())
					.filter((s) => s.startsWith(prefix))
					.map((s) => s.slice(`ss-${spaceId}-`.length));

				if (existingIds.length === 0) return;

				restoreTerminalsForSpace(spaceId, existingIds);
			});
	}, [serverId, spaceId, server?.status]);

	useEffect(() => {
		setSelectedSpace(spaceId || null);
		return () => {
			setSelectedSpace(null);
		};
	}, [setSelectedSpace, spaceId]);

	const activeSpace = useMemo(() => {
		return spaces.find((s) => s.id === spaceId) || null;
	}, [spaces, spaceId]);

	const tabs = useMemo(() => {
		if (!spaceId) return [];
		return spaceTerminals[spaceId] || [];
	}, [spaceId, spaceTerminals]);

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

	useEffect(() => {
		if (!spaceId) {
			return;
		}

		setSelectedTerminalForSpace(spaceId, activeTabId);
	}, [activeTabId, setSelectedTerminalForSpace, spaceId]);

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
		navigate({
			search: { space: spaceId, tab: terminal.id },
		});
	}, [
		activeSpace,
		activeTabId,
		addTerminalToSpace,
		navigate,
		setTerminalCwd,
		spaceId,
		terminalCwds,
	]);

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

			const wasActive = activeTabId === terminalId;
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
			navigate,
			removeTerminalFromSpace,
			setSelectedTerminalForSpace,
			spaceId,
			tabs,
		],
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

	const useGhostty = useGhosttyEnabled();
	const TerminalComponent = useGhostty ? GhosttySSHTerminal : SSHTerminal;
	const activeTerminal = useMemo(() => {
		if (!activeTabId) {
			return null;
		}

		return tabs.find((terminal) => terminal.id === activeTabId) ?? null;
	}, [activeTabId, tabs]);

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
							<button
								key={tab.id}
								type="button"
								className={`group flex h-full shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs transition-colors ${
									activeTabId === tab.id
										? "bg-background text-foreground"
										: "text-muted-foreground hover:bg-background/50 hover:text-foreground"
								}`}
								onClick={() => {
									navigate({ search: { space: spaceId, tab: tab.id } });
								}}
							>
								<span className="max-w-48 truncate">{tab.label}</span>
								<button
									type="button"
									className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
									onClick={(e) => {
										e.stopPropagation();
										handleCloseTab(tab.id);
									}}
									tabIndex={-1}
								>
									<X className="size-3" />
								</button>
							</button>
						))}
					</div>

					<div className="flex shrink-0 items-center gap-0.5 px-2">
						<Button
							variant="ghost"
							size="icon"
							className="size-6"
							onClick={handleAddTerminal}
							title="New Terminal"
						>
							<Plus className="size-3.5" />
						</Button>
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
							{activeSpace.label} · {server.label}
						</span>
					</div>
				</div>

				<div className="flex flex-1 min-h-0">
					<div className="relative flex-1 min-w-0">
						{activeTerminal ? (
							<div key={activeTerminal.id} className="absolute inset-0">
								<TerminalComponent
									serverId={serverId}
									terminalId={activeTerminal.id}
									spaceId={spaceId}
									cwd={terminalCwds[activeTerminal.id]}
									isActive={true}
									onCwdChange={(cwd) => {
										setTerminalCwd(activeTerminal.id, cwd);
										if (spaceId) {
											const dirName = cwd.split("/").filter(Boolean).pop();
											if (dirName) {
												setTerminalLabel(spaceId, activeTerminal.id, dirName);
											}
										}
									}}
									onTitleChange={(title) => {
										if (spaceId && title) {
											setTerminalLabel(spaceId, activeTerminal.id, title);
										}
									}}
								/>
							</div>
						) : null}
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
