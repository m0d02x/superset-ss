import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
	LuFolderGit,
	LuFolderOpen,
	LuFolderPlus,
	LuHardDrive,
	LuMonitor,
	LuPlus,
} from "react-icons/lu";
import { useOpenProject } from "renderer/react-query/projects";
import { useOpenMainRepoWorkspace } from "renderer/react-query/workspaces";
import {
	STROKE_WIDTH,
} from "renderer/screens/main/components/WorkspaceSidebar/constants";
import { useServersStore } from "renderer/stores/servers-state";
import { DashboardSidebarHeader } from "./components/DashboardSidebarHeader";
import { DashboardSidebarProjectSection } from "./components/DashboardSidebarProjectSection";
import { DashboardSidebarServerSection } from "./components/DashboardSidebarServerSection";
import { useDashboardSidebarData } from "./hooks/useDashboardSidebarData";
import { useDashboardSidebarShortcuts } from "./hooks/useDashboardSidebarShortcuts";

type SidebarView = "local" | "servers";

interface DashboardSidebarProps {
	isCollapsed?: boolean;
}

export function DashboardSidebar({
	isCollapsed = false,
}: DashboardSidebarProps) {
	const [view, setView] = useState<SidebarView>(() => {
		const stored = localStorage.getItem("sidebar-view");
		return stored === "servers" ? "servers" : "local";
	});

	const handleViewChange = useCallback((v: SidebarView) => {
		setView(v);
		localStorage.setItem("sidebar-view", v);
	}, []);
	const { groups, refreshWorkspacePullRequest, toggleProjectCollapsed } =
		useDashboardSidebarData();
	const workspaceShortcutLabels = useDashboardSidebarShortcuts(groups);

	return (
		<div className="flex h-full flex-col border-r border-border bg-muted/45 dark:bg-muted/35">
			<DashboardSidebarHeader isCollapsed={isCollapsed} />

			<SidebarViewToggle
				view={view}
				onViewChange={handleViewChange}
				isCollapsed={isCollapsed}
			/>

			<div className="flex-1 overflow-y-auto hide-scrollbar">
				{view === "local" ? (
					<>
						{groups.map((project) => (
							<DashboardSidebarProjectSection
								key={project.id}
								project={project}
								isSidebarCollapsed={isCollapsed}
								workspaceShortcutLabels={workspaceShortcutLabels}
								onWorkspaceHover={refreshWorkspacePullRequest}
								onToggleCollapse={toggleProjectCollapsed}
							/>
						))}
					</>
				) : (
					<DashboardSidebarServerSection />
				)}
			</div>

			<SidebarFooter view={view} isCollapsed={isCollapsed} />
		</div>
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

function SidebarFooter({
	view,
	isCollapsed,
}: {
	view: SidebarView;
	isCollapsed: boolean;
}) {
	if (view === "servers") {
		return <SidebarFooterServer isCollapsed={isCollapsed} />;
	}
	return <SidebarFooterLocal isCollapsed={isCollapsed} />;
}

function SidebarFooterServer({ isCollapsed }: { isCollapsed: boolean }) {
	const openAddServerDialog = useServersStore((s) => s.openAddServerDialog);

	if (isCollapsed) {
		return (
			<div className="border-t border-border p-2 flex flex-col items-center">
				<Tooltip delayDuration={300}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-8 text-muted-foreground hover:text-foreground"
							onClick={openAddServerDialog}
						>
							<LuPlus className="size-4" strokeWidth={STROKE_WIDTH} />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">Add server</TooltipContent>
				</Tooltip>
			</div>
		);
	}

	return (
		<div className="border-t border-border p-2">
			<Button
				variant="ghost"
				size="sm"
				className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
				onClick={openAddServerDialog}
			>
				<LuPlus className="size-4" strokeWidth={STROKE_WIDTH} />
				<span>Add server</span>
			</Button>
		</div>
	);
}

function SidebarFooterLocal({ isCollapsed }: { isCollapsed: boolean }) {
	const navigate = useNavigate();
	const { openNew, isPending: isOpenPending } = useOpenProject();
	const openMainRepoWorkspace = useOpenMainRepoWorkspace();

	const handleOpenProject = async () => {
		try {
			const projects = await openNew();
			for (const project of projects) {
				try {
					await openMainRepoWorkspace.mutateAsync({
						projectId: project.id,
					});
				} catch (err) {
					toast.error(`Failed to open ${project.name}`, {
						description:
							err instanceof Error ? err.message : "Failed to create workspace",
					});
				}
			}
		} catch (error) {
			toast.error("Failed to open project", {
				description:
					error instanceof Error ? error.message : "An unknown error occurred",
			});
		}
	};

	const isLoading = isOpenPending || openMainRepoWorkspace.isPending;

	if (isCollapsed) {
		return (
			<div className="border-t border-border p-2 flex flex-col items-center">
				<DropdownMenu>
					<Tooltip delayDuration={300}>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="size-8 text-muted-foreground hover:text-foreground"
									disabled={isLoading}
								>
									<LuFolderPlus className="size-4" strokeWidth={STROKE_WIDTH} />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<TooltipContent side="right">Add repository</TooltipContent>
					</Tooltip>
					<DropdownMenuContent side="top" align="start">
						<DropdownMenuItem onClick={handleOpenProject} disabled={isLoading}>
							<LuFolderOpen className="size-4" strokeWidth={STROKE_WIDTH} />
							Open project
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => navigate({ to: "/new-project" })}>
							<LuFolderGit className="size-4" strokeWidth={STROKE_WIDTH} />
							New project
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		);
	}

	return (
		<div className="border-t border-border p-2">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
						disabled={isLoading}
					>
						<LuFolderPlus className="size-4" strokeWidth={STROKE_WIDTH} />
						<span>Add repository</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent side="top" align="start">
					<DropdownMenuItem onClick={handleOpenProject} disabled={isLoading}>
						<LuFolderOpen className="size-4" strokeWidth={STROKE_WIDTH} />
						Open project
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => navigate({ to: "/new-project" })}>
						<LuFolderGit className="size-4" strokeWidth={STROKE_WIDTH} />
						New project
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
