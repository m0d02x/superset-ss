const LOCAL_SPACE_WORKSPACE_ID_PREFIX = "local-space-";

export function isSyntheticLocalWorkspaceId(workspaceId: string): boolean {
	return workspaceId.startsWith(LOCAL_SPACE_WORKSPACE_ID_PREFIX);
}

export function getLocalSpaceWorkspaceId(spaceId: string): string {
	return `${LOCAL_SPACE_WORKSPACE_ID_PREFIX}${spaceId}`;
}

export function getLocalSpaceIdFromWorkspaceId(
	workspaceId: string,
): string | null {
	return isSyntheticLocalWorkspaceId(workspaceId)
		? workspaceId.slice(LOCAL_SPACE_WORKSPACE_ID_PREFIX.length)
		: null;
}
