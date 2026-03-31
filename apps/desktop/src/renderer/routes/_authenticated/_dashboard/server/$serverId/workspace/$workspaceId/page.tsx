import { Button } from "@superset/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuPanelRight } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	buildRemoteSessionKey,
	useRemoteSessionsStore,
} from "renderer/stores/remote-sessions";
import { RemoteFileViewer } from "./components/RemoteFileViewer";
import { ServerWorkspaceSidebar } from "./components/ServerWorkspaceSidebar";
import { SSHTerminal } from "./components/SSHTerminal";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/server/$serverId/workspace/$workspaceId/",
)({
	component: ServerWorkspacePage,
});

type Tab =
	| { type: "terminal"; id: string; label: string }
	| { type: "fileviewer"; id: string; label: string; filePath: string };

function ServerWorkspacePage() {
	const { serverId, workspaceId } = Route.useParams();
	const worktreePath = decodeURIComponent(workspaceId);
	const { data: server } = electronTrpc.servers.get.useQuery({ id: serverId });
	const execMutation = electronTrpc.servers.exec.useMutation();
	const tabCounterRef = useRef(1);

	const [tabs, setTabs] = useState<Tab[]>([
		{ type: "terminal", id: "term-1", label: "Terminal 1" },
	]);
	const [activeTabId, setActiveTabId] = useState("term-1");
	const [isSidebarOpen, setIsSidebarOpen] = useState(true);
	const [sidebarWidth, setSidebarWidth] = useState(260);
	const destroySession = useRemoteSessionsStore(
		(state) => state.destroySession,
	);
	const releaseSession = useRemoteSessionsStore(
		(state) => state.releaseSession,
	);
	const terminalIdsRef = useRef<string[]>(["term-1"]);
	const restoredRef = useRef(false);

	// Restore tabs from existing tmux sessions on mount
	useEffect(() => {
		if (restoredRef.current) return;
		restoredRef.current = true;

		const prefix = `ss-${workspaceId}-term-`;
		execMutation
			.mutateAsync({
				id: serverId,
				command:
					"tmux list-sessions -F '#{session_name}:#{pane_title}' 2>/dev/null || true",
			})
			.then((result) => {
				if (result.code !== 0 || !result.stdout.trim()) return;

				const sessions = result.stdout
					.split("\n")
					.map((s) => s.trim())
					.filter((s) => s.startsWith(prefix));

				if (sessions.length === 0) return;

				const parsed = sessions.map((s) => {
					const colonIdx = s.indexOf(":", prefix.length);
					const sessionName = colonIdx >= 0 ? s.slice(0, colonIdx) : s;
					const paneTitle = colonIdx >= 0 ? s.slice(colonIdx + 1).trim() : "";
					const id = sessionName.slice(`ss-${workspaceId}-`.length);
					return { id, paneTitle };
				});

				// Find the highest term number to set counter
				const maxNum = Math.max(
					...parsed.map(({ id }) => {
						const n = Number.parseInt(id.replace("term-", ""), 10);
						return Number.isNaN(n) ? 0 : n;
					}),
				);
				tabCounterRef.current = maxNum;

				const restoredTabs: Tab[] = parsed.map(({ id, paneTitle }) => {
					const num = id.replace("term-", "");
					const label = paneTitle || `Terminal ${num}`;
					return { type: "terminal", id, label };
				});

				setTabs(restoredTabs);
				setActiveTabId(restoredTabs[0].id);
			});
	}, [serverId, workspaceId]);

	const updateTabLabel = useCallback((tabId: string, label: string) => {
		setTabs((prev) =>
			prev.map((t) => (t.id === tabId ? { ...t, label } : t)),
		);
	}, []);

	const addTerminal = useCallback(() => {
		tabCounterRef.current += 1;
		const num = tabCounterRef.current;
		const id = `term-${num}`;
		setTabs((prev) => [
			...prev,
			{ type: "terminal", id, label: `Terminal ${num}` },
		]);
		setActiveTabId(id);
	}, []);

	const activateTab = useCallback((tabId: string) => {
		setActiveTabId(tabId);
	}, []);

	const openFileViewer = useCallback(
		(filePath: string) => {
			const existingTab = tabs.find(
				(t) => t.type === "fileviewer" && t.filePath === filePath,
			);
			if (existingTab) {
				activateTab(existingTab.id);
				return;
			}
			const fileName = filePath.split("/").pop() ?? filePath;
			const id = `file-${Date.now()}`;
			setTabs((prev) => [
				...prev,
				{ type: "fileviewer", id, label: fileName, filePath },
			]);
			activateTab(id);
		},
		[tabs, activateTab],
	);

	const closeTab = useCallback(
		(id: string) => {
			destroySession(
				buildRemoteSessionKey({
					serverId,
					workspaceId,
					terminalId: id,
				}),
			);
			setTabs((prev) => {
				const next = prev.filter((t) => t.id !== id);
				if (next.length === 0) {
					tabCounterRef.current += 1;
					const num = tabCounterRef.current;
					const newId = `term-${num}`;
					setActiveTabId(newId);
					return [
						{
							type: "terminal" as const,
							id: newId,
							label: `Terminal ${num}`,
						},
					];
				}
				if (activeTabId === id) {
					activateTab(next[next.length - 1].id);
				}
				return next;
			});
		},
		[activeTabId, activateTab, destroySession, serverId, workspaceId],
	);

	useEffect(() => {
		terminalIdsRef.current = tabs
			.filter(
				(tab): tab is Extract<Tab, { type: "terminal" }> =>
					tab.type === "terminal",
			)
			.map((tab) => tab.id);
	}, [tabs]);

	// On unmount (navigating away), release sessions so tmux stays alive
	// for reattach. destroySession is only called on explicit tab close.
	useEffect(() => {
		return () => {
			for (const terminalId of terminalIdsRef.current) {
				releaseSession(
					buildRemoteSessionKey({
						serverId,
						workspaceId,
						terminalId,
					}),
				);
			}
		};
	}, [releaseSession, serverId, workspaceId]);

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

	if (!server || server.status !== "connected") {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				Server not connected
			</div>
		);
	}

	const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

	return (
		<div className="flex h-full w-full overflow-hidden">
			<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
				<div className="flex shrink-0 items-center border-b border-border bg-muted/30 h-10">
					<div className="flex-1 flex items-center overflow-x-auto hide-scrollbar">
						{tabs.map((tab) => (
							<button
								key={tab.id}
								type="button"
								className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs border-r border-border shrink-0 transition-colors ${
									activeTabId === tab.id
										? "bg-background text-foreground"
										: "text-muted-foreground hover:text-foreground hover:bg-background/50"
								}`}
								onClick={() => activateTab(tab.id)}
							>
								<span className="truncate max-w-32">{tab.label}</span>
								<button
									type="button"
									className="opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-0.5 transition-opacity"
									onClick={(e) => {
										e.stopPropagation();
										closeTab(tab.id);
									}}
									tabIndex={-1}
								>
									<X className="size-3" />
								</button>
							</button>
						))}
					</div>

					<div className="flex items-center gap-0.5 px-2 shrink-0">
						<Button
							variant="ghost"
							size="icon"
							className="size-6"
							onClick={addTerminal}
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

					<div className="flex items-center gap-2 px-3 shrink-0 border-l border-border">
						<div className="size-1.5 rounded-full bg-emerald-500" />
						<span className="text-[10px] text-muted-foreground">
							{server.label}
						</span>
					</div>
				</div>

				<div className="relative flex-1">
					{tabs
						.filter((t) => t.type === "terminal")
						.map((tab) => (
							<div
								key={tab.id}
								className="absolute inset-0"
								style={{
									visibility: activeTabId === tab.id ? "visible" : "hidden",
									pointerEvents: activeTabId === tab.id ? "auto" : "none",
								}}
							>
								<SSHTerminal
									serverId={serverId}
									workspaceId={workspaceId}
									terminalId={tab.id}
									cwd={worktreePath}
									onTitleChange={(title) =>
										updateTabLabel(tab.id, title)
									}
								/>
							</div>
						))}

					{activeTab?.type === "fileviewer" && (
						<div className="absolute inset-0">
							<RemoteFileViewer
								serverId={serverId}
								filePath={activeTab.filePath}
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
						rootPath={worktreePath}
						onFileSelect={openFileViewer}
					/>
				</div>
			)}
		</div>
	);
}
