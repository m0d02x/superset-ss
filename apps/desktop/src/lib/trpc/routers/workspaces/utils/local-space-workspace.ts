import os from "node:os";
import { appState } from "main/lib/app-state";
import type { LocalSpace } from "main/lib/app-state/schemas";

export const LOCAL_SPACE_WORKSPACE_ID_PREFIX = "local-space-";

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

export function getLocalSpaceByWorkspaceId(
	workspaceId: string,
): LocalSpace | null {
	const localSpaceId = getLocalSpaceIdFromWorkspaceId(workspaceId);
	if (!localSpaceId) {
		return null;
	}

	return (
		appState.data.localSpaces.spaces.find(
			(space) => space.id === localSpaceId,
		) ?? null
	);
}

export function getResolvedLocalSpaceDirectory(localSpace: LocalSpace): string {
	return localSpace.directory ?? os.homedir();
}

export function createSyntheticLocalWorkspace(
	localSpace: LocalSpace,
	workspaceId: string,
) {
	const resolvedDirectory = getResolvedLocalSpaceDirectory(localSpace);
	return {
		id: workspaceId,
		projectId: null,
		sectionId: null,
		worktreeId: null,
		branch: localSpace.label,
		name: localSpace.label,
		tabOrder: localSpace.sortOrder,
		type: "branch" as const,
		createdAt: localSpace.createdAt,
		updatedAt: localSpace.updatedAt,
		lastOpenedAt: localSpace.lastOpenedAt,
		isUnread: false,
		isUnnamed: false,
		deletingAt: null,
		worktreePath: resolvedDirectory,
		project: null,
		worktree: null,
		isLocalSpace: true,
		localSpace: {
			id: localSpace.id,
			label: localSpace.label,
			directory: resolvedDirectory,
			color: localSpace.color ?? null,
		},
	};
}
