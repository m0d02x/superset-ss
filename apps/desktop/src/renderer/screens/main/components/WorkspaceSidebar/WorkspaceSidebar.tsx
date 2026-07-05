import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useEffect } from "react";
import { LuHardDrive } from "react-icons/lu";
import { DashboardSidebarServerSection } from "renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/components/DashboardSidebarServerSection";
import { useWorkspaceSelectionStore } from "renderer/stores/workspace-selection";
import { MultiDragPreview } from "./MultiDragPreview";
import { SetupScriptCard } from "./SetupScriptCard";
import { SidebarDropZone } from "./SidebarDropZone";
import { WorkspaceSidebarFooter } from "./WorkspaceSidebarFooter";
import { WorkspaceSidebarHeader } from "./WorkspaceSidebarHeader";

interface WorkspaceSidebarProps {
	isCollapsed?: boolean;
	activeProjectId: string | null;
	activeProjectName: string | null;
}

export function WorkspaceSidebar({
	isCollapsed = false,
	activeProjectId,
	activeProjectName,
}: WorkspaceSidebarProps) {
	const clearSelection = useWorkspaceSelectionStore((s) => s.clearSelection);

	useEffect(() => {
		localStorage.setItem("sidebar-view", "servers");

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

	return (
		<SidebarDropZone className="flex flex-col h-full bg-muted/45 dark:bg-muted/35">
			<WorkspaceSidebarHeader isCollapsed={isCollapsed} />

			<SidebarViewToggle isCollapsed={isCollapsed} />

			<div className="flex-1 overflow-y-auto hide-scrollbar">
				<DashboardSidebarServerSection />
			</div>

			<SetupScriptCard
				isCollapsed={isCollapsed}
				projectId={activeProjectId}
				projectName={activeProjectName}
			/>

			<WorkspaceSidebarFooter isCollapsed={isCollapsed} view="servers" />
			<MultiDragPreview />
		</SidebarDropZone>
	);
}

function SidebarViewToggle({ isCollapsed }: { isCollapsed: boolean }) {
	if (isCollapsed) {
		return (
			<div className="flex flex-col items-center gap-1 border-b border-border py-1.5">
				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<div
							className={cn(
								"flex size-7 items-center justify-center rounded-md bg-accent text-foreground",
							)}
						>
							<LuHardDrive className="size-3.5" />
						</div>
					</TooltipTrigger>
					<TooltipContent side="right">Servers</TooltipContent>
				</Tooltip>
			</div>
		);
	}

	return (
		<div className="border-b border-border px-2 py-1.5">
			<div className="flex h-7 rounded-md bg-muted p-0.5">
				<div
					className={cn(
						"flex flex-1 items-center justify-center gap-1.5 rounded-[5px] text-xs font-medium transition-all",
						"bg-background text-foreground shadow-sm",
					)}
				>
					<LuHardDrive className="size-3" />
					Servers
				</div>
			</div>
		</div>
	);
}
