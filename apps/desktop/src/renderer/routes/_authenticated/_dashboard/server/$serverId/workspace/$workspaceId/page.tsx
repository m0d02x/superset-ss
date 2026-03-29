import { Button } from "@superset/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useCallback, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { RemoteFileExplorer } from "./components/RemoteFileExplorer";
import { RemoteFileViewer } from "./components/RemoteFileViewer";
import { RemoteGitStatus } from "./components/RemoteGitStatus";
import { SSHTerminal } from "./components/SSHTerminal";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/server/$serverId/workspace/$workspaceId/",
)({
	component: ServerWorkspacePage,
});

type Tab =
	| { type: "terminal"; id: string; label: string }
	| { type: "files"; id: "files"; label: string }
	| { type: "changes"; id: "changes"; label: string };

let tabCounter = 1;

function ServerWorkspacePage() {
	const { serverId, workspaceId } = Route.useParams();
	const worktreePath = decodeURIComponent(workspaceId);
	const { data: server } = electronTrpc.servers.get.useQuery({ id: serverId });
	const [selectedFile, setSelectedFile] = useState<string | null>(null);

	const [tabs, setTabs] = useState<Tab[]>([
		{ type: "terminal", id: "term-1", label: "Terminal 1" },
	]);
	const [activeTabId, setActiveTabId] = useState("term-1");

	const addTerminal = useCallback(() => {
		tabCounter += 1;
		const id = `term-${tabCounter}`;
		setTabs((prev) => [
			...prev,
			{ type: "terminal", id, label: `Terminal ${tabCounter}` },
		]);
		setActiveTabId(id);
	}, []);

	const addFilesTab = useCallback(() => {
		if (tabs.some((t) => t.id === "files")) {
			setActiveTabId("files");
			return;
		}
		setTabs((prev) => [
			...prev,
			{ type: "files", id: "files", label: "Files" },
		]);
		setActiveTabId("files");
	}, [tabs]);

	const addChangesTab = useCallback(() => {
		if (tabs.some((t) => t.id === "changes")) {
			setActiveTabId("changes");
			return;
		}
		setTabs((prev) => [
			...prev,
			{ type: "changes", id: "changes", label: "Changes" },
		]);
		setActiveTabId("changes");
	}, [tabs]);

	const closeTab = useCallback(
		(id: string) => {
			setTabs((prev) => {
				const next = prev.filter((t) => t.id !== id);
				if (next.length === 0) {
					// Always keep at least one terminal
					tabCounter += 1;
					const newId = `term-${tabCounter}`;
					setActiveTabId(newId);
					return [
						{
							type: "terminal" as const,
							id: newId,
							label: `Terminal ${tabCounter}`,
						},
					];
				}
				if (activeTabId === id) {
					setActiveTabId(next[next.length - 1].id);
				}
				return next;
			});
		},
		[activeTabId],
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
		<div className="flex h-full w-full flex-col overflow-hidden">
			{/* Tab bar */}
			<div className="flex shrink-0 items-center border-b border-border bg-muted/30">
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
							onClick={() => setActiveTabId(tab.id)}
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

				{/* Add buttons */}
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
						className="size-6 text-xs"
						onClick={addFilesTab}
						title="Files"
					>
						F
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="size-6 text-xs"
						onClick={addChangesTab}
						title="Changes"
					>
						G
					</Button>
				</div>

				{/* Server info */}
				<div className="flex items-center gap-2 px-3 shrink-0 border-l border-border">
					<div className="size-1.5 rounded-full bg-emerald-500" />
					<span className="text-[10px] text-muted-foreground">
						{server.label}
					</span>
				</div>
			</div>

			{/* Content — all terminals stay mounted, only visibility toggles */}
			<div className="relative flex-1">
				{/* Terminal tabs — keep mounted, toggle visibility */}
				{tabs
					.filter((t) => t.type === "terminal")
					.map((tab) => (
						<div
							key={tab.id}
							className={`absolute inset-0 ${activeTabId === tab.id ? "" : "invisible"}`}
						>
							<SSHTerminal serverId={serverId} cwd={worktreePath} />
						</div>
					))}

				{/* Files tab */}
				{activeTab?.type === "files" && (
					<div className="absolute inset-0 flex">
						<div className="w-64 shrink-0 border-r border-border overflow-auto">
							<RemoteFileExplorer
								serverId={serverId}
								rootPath={worktreePath}
								selectedFile={selectedFile}
								onSelectFile={setSelectedFile}
							/>
						</div>
						<div className="flex-1 min-w-0 overflow-hidden">
							{selectedFile ? (
								<RemoteFileViewer serverId={serverId} filePath={selectedFile} />
							) : (
								<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
									Select a file to view
								</div>
							)}
						</div>
					</div>
				)}

				{/* Changes tab */}
				{activeTab?.type === "changes" && (
					<div className="absolute inset-0 overflow-auto p-4">
						<RemoteGitStatus serverId={serverId} repoPath={worktreePath} />
					</div>
				)}
			</div>
		</div>
	);
}
