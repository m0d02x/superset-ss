import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import { toast } from "@superset/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { LuFolderGit, LuFolderOpen, LuFolderPlus, LuPlus } from "react-icons/lu";
import { useOpenProject } from "renderer/react-query/projects";
import { useOpenMainRepoWorkspace } from "renderer/react-query/workspaces";
import { useServersStore } from "renderer/stores/servers-state";
import { STROKE_WIDTH } from "./constants";

interface WorkspaceSidebarFooterProps {
	isCollapsed?: boolean;
	view?: "local" | "servers";
}

export function WorkspaceSidebarFooter({
	isCollapsed = false,
	view = "local",
}: WorkspaceSidebarFooterProps) {
	if (view === "servers") {
		return <ServerFooter isCollapsed={isCollapsed} />;
	}
	return <LocalFooter isCollapsed={isCollapsed} />;
}

function ServerFooter({ isCollapsed }: { isCollapsed: boolean }) {
	const openAddServerDialog = useServersStore((s) => s.openAddServerDialog);

	if (isCollapsed) {
		return (
			<div className="border-t border-border p-2 flex flex-col items-center gap-1">
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
		<div className="border-t border-border p-2 flex items-center gap-2">
			<Button
				variant="ghost"
				size="sm"
				className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
				onClick={openAddServerDialog}
			>
				<LuPlus className="w-4 h-4" strokeWidth={STROKE_WIDTH} />
				<span>Add server</span>
			</Button>
		</div>
	);
}

function LocalFooter({ isCollapsed }: { isCollapsed: boolean }) {
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
			<div className="border-t border-border p-2 flex flex-col items-center gap-1">
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
		<div className="border-t border-border p-2 flex items-center gap-2">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
						disabled={isLoading}
					>
						<LuFolderPlus className="w-4 h-4" strokeWidth={STROKE_WIDTH} />
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
