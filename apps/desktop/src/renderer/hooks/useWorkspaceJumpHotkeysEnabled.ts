import { useMatchRoute } from "@tanstack/react-router";

export function useWorkspaceJumpHotkeysEnabled(): boolean {
	const matchRoute = useMatchRoute();
	const isV2WorkspaceOpen =
		matchRoute({ to: "/v2-workspace/$workspaceId", fuzzy: true }) !== false;
	const isServerWorkspaceOpen =
		matchRoute({ to: "/server/$serverId", fuzzy: true }) !== false;

	return !isV2WorkspaceOpen && !isServerWorkspaceOpen;
}
