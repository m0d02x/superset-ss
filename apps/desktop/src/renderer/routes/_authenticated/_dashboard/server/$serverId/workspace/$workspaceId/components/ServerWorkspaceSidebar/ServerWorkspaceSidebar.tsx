import { useCallback, useState } from "react";
import { LuFile, LuGitCompareArrows } from "react-icons/lu";
import { FilesView } from "renderer/screens/main/components/WorkspaceView/RightSidebar/FilesView";
import { getSidebarHeaderTabButtonClassName } from "renderer/screens/main/components/WorkspaceView/RightSidebar/headerTabStyles";
import type { DirectoryEntry } from "shared/file-tree-types";
import { useRemoteFileTreeAdapter } from "../../adapters/useRemoteFileTreeAdapter";
import { RemoteGitStatus } from "../RemoteGitStatus";

type SidebarTab = "files" | "changes";

interface ServerWorkspaceSidebarProps {
	serverId: string;
	rootPath: string | undefined;
	onFileSelect: (filePath: string) => void;
}

export function ServerWorkspaceSidebar({
	serverId,
	rootPath,
	onFileSelect,
}: ServerWorkspaceSidebarProps) {
	const [activeTab, setActiveTab] = useState<SidebarTab>("files");
	const adapter = useRemoteFileTreeAdapter({ serverId, rootPath });

	const handleFileActivate = useCallback(
		(entry: DirectoryEntry) => {
			onFileSelect(entry.path);
		},
		[onFileSelect],
	);

	return (
		<aside className="h-full flex flex-col overflow-hidden">
			<div className="flex items-center bg-background shrink-0 h-10 border-b">
				<div className="flex items-center h-full">
					<button
						type="button"
						onClick={() => setActiveTab("files")}
						className={getSidebarHeaderTabButtonClassName({
							isActive: activeTab === "files",
						})}
					>
						<LuFile className="size-3.5" />
						Files
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("changes")}
						className={getSidebarHeaderTabButtonClassName({
							isActive: activeTab === "changes",
						})}
					>
						<LuGitCompareArrows className="size-3.5" />
						Changes
					</button>
				</div>
			</div>

			<div
				className={
					activeTab === "files"
						? "flex-1 min-h-0 flex flex-col overflow-hidden"
						: "hidden"
				}
			>
				{rootPath ? (
					<FilesView
						adapter={adapter}
						rootPath={rootPath}
						onFileActivate={handleFileActivate}
					/>
				) : (
					<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
						Set a directory for this space to browse files
					</div>
				)}
			</div>

			<div
				className={
					activeTab === "changes"
						? "flex-1 min-h-0 overflow-auto p-4"
						: "hidden"
				}
			>
				{rootPath ? (
					<RemoteGitStatus serverId={serverId} repoPath={rootPath} />
				) : (
					<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4 text-center">
						Set a directory for this space to view changes
					</div>
				)}
			</div>
		</aside>
	);
}
