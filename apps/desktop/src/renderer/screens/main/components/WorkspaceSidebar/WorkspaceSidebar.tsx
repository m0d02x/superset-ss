import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LuHardDrive, LuMonitor } from "react-icons/lu";
import { useWorkspaceShortcuts } from "renderer/hooks/useWorkspaceShortcuts";
import { DashboardSidebarServerSection } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarServerSection";
import { useWorkspaceSelectionStore } from "renderer/stores/workspace-selection";
import { MultiDragPreview } from "./MultiDragPreview";
import { PortsList } from "./PortsList";
import { ProjectSection } from "./ProjectSection";
import { SetupScriptCard } from "./SetupScriptCard";
import { SidebarDropZone } from "./SidebarDropZone";
import { WorkspaceSidebarFooter } from "./WorkspaceSidebarFooter";
import { WorkspaceSidebarHeader } from "./WorkspaceSidebarHeader";

interface WorkspaceSidebarProps {
	isCollapsed?: boolean;
	activeProjectId: string | null;
	activeProjectName: string | null;
}

type SidebarView = "local" | "servers";

export function WorkspaceSidebar({
	isCollapsed = false,
	activeProjectId,
	activeProjectName,
}: WorkspaceSidebarProps) {
	const [view, setView] = useState<SidebarView>(() => {
		const stored = localStorage.getItem("sidebar-view");
		return stored === "servers" ? "servers" : "local";
	});

	const handleViewChange = useCallback((v: SidebarView) => {
		setView(v);
		localStorage.setItem("sidebar-view", v);
	}, []);
	const { groups } = useWorkspaceShortcuts();
	const clearSelection = useWorkspaceSelectionStore((s) => s.clearSelection);

	const projectShortcutIndices = useMemo(
		() =>
			groups.reduce<{ indices: number[]; cumulative: number }>(
				(acc, group) => ({
					indices: [...acc.indices, acc.cumulative],
					cumulative:
						acc.cumulative +
						group.workspaces.length +
						(group.sections ?? []).reduce(
							(sum, s) => sum + s.workspaces.length,
							0,
						),
				}),
				{ indices: [], cumulative: 0 },
			).indices,
		[groups],
	);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (
					(e.target as HTMLElement).closest(
						"input, textarea, [contenteditable]",
					)
				)
					return;
				clearSelection();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [clearSelection]);

	const handleSidebarMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (
				(e.target as HTMLElement).closest("[role='button'], button, a, input")
			) {
				return;
			}
			clearSelection();
		},
		[clearSelection],
	);

	return (
		<SidebarDropZone className="flex flex-col h-full bg-muted/45 dark:bg-muted/35">
			<WorkspaceSidebarHeader isCollapsed={isCollapsed} />

			<SidebarViewToggle
				view={view}
				onViewChange={handleViewChange}
				isCollapsed={isCollapsed}
			/>

			{view === "local" ? (
				<>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: mousedown on empty sidebar space clears selection */}
					<div
						className="flex-1 overflow-y-auto hide-scrollbar"
						onMouseDown={handleSidebarMouseDown}
					>
						{groups.map((group, index) => (
							<ProjectSection
								key={group.project.id}
								projectId={group.project.id}
								projectName={group.project.name}
								projectColor={group.project.color}
								githubOwner={group.project.githubOwner}
								mainRepoPath={group.project.mainRepoPath}
								hideImage={group.project.hideImage}
								iconUrl={group.project.iconUrl}
								serverId={group.project.serverId}
								remoteRepoPath={group.project.remoteRepoPath}
								workspaces={group.workspaces}
								sections={group.sections ?? []}
								topLevelItems={group.topLevelItems}
								shortcutBaseIndex={projectShortcutIndices[index]}
								index={index}
								isCollapsed={isCollapsed}
							/>
						))}

						{groups.length === 0 && !isCollapsed && (
							<div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
								<span>No workspaces yet</span>
								<span className="text-xs mt-1">
									Add project or drag a Git repo folder here
								</span>
							</div>
						)}
					</div>

					{!isCollapsed && <PortsList />}
				</>
			) : (
				<div className="flex-1 overflow-y-auto hide-scrollbar">
					<DashboardSidebarServerSection />
				</div>
			)}

			<SetupScriptCard
				isCollapsed={isCollapsed}
				projectId={activeProjectId}
				projectName={activeProjectName}
			/>

			<WorkspaceSidebarFooter isCollapsed={isCollapsed} view={view} />
			<MultiDragPreview />
		</SidebarDropZone>
	);
}

function SidebarViewToggle({
	view,
	onViewChange,
	isCollapsed,
}: {
	view: SidebarView;
	onViewChange: (view: SidebarView) => void;
	isCollapsed: boolean;
}) {
	if (isCollapsed) {
		return (
			<div className="flex flex-col items-center gap-1 border-b border-border py-1.5">
				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => onViewChange("local")}
							className={cn(
								"flex size-7 items-center justify-center rounded-md transition-colors",
								view === "local"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
							)}
						>
							<LuMonitor className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">Local</TooltipContent>
				</Tooltip>
				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => onViewChange("servers")}
							className={cn(
								"flex size-7 items-center justify-center rounded-md transition-colors",
								view === "servers"
									? "bg-accent text-foreground"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
							)}
						>
							<LuHardDrive className="size-3.5" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">Servers</TooltipContent>
				</Tooltip>
			</div>
		);
	}

	return (
		<div className="border-b border-border px-2 py-1.5">
			<div className="flex h-7 rounded-md bg-muted p-0.5">
				<button
					type="button"
					onClick={() => onViewChange("local")}
					className={cn(
						"flex flex-1 items-center justify-center gap-1.5 rounded-[5px] text-xs font-medium transition-all",
						view === "local"
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					<LuMonitor className="size-3" />
					Local
				</button>
				<button
					type="button"
					onClick={() => onViewChange("servers")}
					className={cn(
						"flex flex-1 items-center justify-center gap-1.5 rounded-[5px] text-xs font-medium transition-all",
						view === "servers"
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					<LuHardDrive className="size-3" />
					Servers
				</button>
			</div>
		</div>
	);
}
