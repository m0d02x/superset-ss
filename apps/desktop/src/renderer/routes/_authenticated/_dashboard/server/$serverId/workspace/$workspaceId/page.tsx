import { Button } from "@superset/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useCallback, useState } from "react";
import { LuPanelRight } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
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

let tabCounter = 1;

function ServerWorkspacePage() {
	const { serverId, workspaceId } = Route.useParams();
	const worktreePath = decodeURIComponent(workspaceId);
	const { data: server } = electronTrpc.servers.get.useQuery({ id: serverId });

	const [tabs, setTabs] = useState<Tab[]>([
		{ type: "terminal", id: "term-1", label: "Terminal 1" },
	]);
	const [activeTabId, setActiveTabId] = useState("term-1");
	const [activatedTabIds, setActivatedTabIds] = useState<Set<string>>(
		() => new Set(["term-1"]),
	);

	const [isSidebarOpen, setIsSidebarOpen] = useState(true);
	const [sidebarWidth, setSidebarWidth] = useState(260);

	const addTerminal = useCallback(() => {
		tabCounter += 1;
		const id = `term-${tabCounter}`;
		setTabs((prev) => [
			...prev,
			{ type: "terminal", id, label: `Terminal ${tabCounter}` },
		]);
		setActiveTabId(id);
		setActivatedTabIds((prev) => {
			const next = new Set(prev);
			next.add(id);
			return next;
		});
	}, []);

	const activateTab = useCallback((tabId: string) => {
		setActiveTabId(tabId);
		setActivatedTabIds((prev) => {
			if (prev.has(tabId)) {
				return prev;
			}
			const next = new Set(prev);
			next.add(tabId);
			return next;
		});
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
			setTabs((prev) => {
				const next = prev.filter((t) => t.id !== id);
				if (next.length === 0) {
					tabCounter += 1;
					const newId = `term-${tabCounter}`;
					setActiveTabId(newId);
					setActivatedTabIds(new Set([newId]));
					return [
						{
							type: "terminal" as const,
							id: newId,
							label: `Terminal ${tabCounter}`,
						},
					];
				}
				if (activeTabId === id) {
					activateTab(next[next.length - 1].id);
				}
				return next;
			});
			setActivatedTabIds((prev) => {
				if (!prev.has(id)) {
					return prev;
				}
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
		},
		[activeTabId, activateTab],
	);

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
						.map((tab) =>
							activatedTabIds.has(tab.id) ? (
								<div
									key={tab.id}
									className={`absolute inset-0 ${activeTabId === tab.id ? "" : "invisible"}`}
								>
									<SSHTerminal serverId={serverId} cwd={worktreePath} />
								</div>
							) : null,
						)}

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
