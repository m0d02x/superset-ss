import { Spinner } from "@superset/ui/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

export const Route = createFileRoute("/_authenticated/_dashboard/workspace/")({
	component: WorkspaceIndexPage,
});

function LoadingSpinner() {
	return (
		<div className="flex h-full w-full items-center justify-center">
			<Spinner className="size-5" />
		</div>
	);
}

function WorkspaceIndexPage() {
	const navigate = useNavigate();
	const { data: workspaces, isLoading } =
		electronTrpc.workspaces.getAllGrouped.useQuery();

	const allWorkspaces = workspaces?.flatMap((group) => group.workspaces) ?? [];
	const hasNoWorkspaces = !isLoading && allWorkspaces.length === 0;

	useEffect(() => {
		if (isLoading || !workspaces) return;

		if (allWorkspaces.length === 0) {
			// Stay on dashboard with empty sidebar instead of redirecting to onboarding
			return;
		}

		// Try to restore last viewed workspace
		const lastViewedId = localStorage.getItem("lastViewedWorkspaceId");
		const targetWorkspace =
			allWorkspaces.find((w) => w.id === lastViewedId) ?? allWorkspaces[0];

		if (targetWorkspace) {
			// Check if this workspace belongs to a remote project
			const parentGroup = workspaces?.find((g) =>
				g.workspaces.some((w) => w.id === targetWorkspace.id),
			);
			const serverId = parentGroup?.project.serverId;

			if (serverId) {
				navigate({
					to: "/server/$serverId/workspace/$workspaceId",
					params: {
						serverId,
						workspaceId: encodeURIComponent(targetWorkspace.worktreePath),
					},
					replace: true,
				});
			} else {
				navigate({
					to: "/workspace/$workspaceId",
					params: { workspaceId: targetWorkspace.id },
					replace: true,
				});
			}
		}
	}, [workspaces, isLoading, navigate, allWorkspaces]);

	if (hasNoWorkspaces) {
		return <LoadingSpinner />;
	}

	return <LoadingSpinner />;
}
