import { isSyntheticLocalWorkspaceId } from "renderer/lib/local-space-workspace";

export function shouldKeepAttachAliveOnUnmount({
	paneDestroyed,
	hasWorkspaceRun,
	isStartingWorkspaceRun,
	hasActiveAttachRequest,
	workspaceId,
}: {
	paneDestroyed: boolean;
	hasWorkspaceRun: boolean;
	isStartingWorkspaceRun: boolean;
	hasActiveAttachRequest: boolean;
	workspaceId: string;
}): boolean {
	return (
		!paneDestroyed &&
		(isSyntheticLocalWorkspaceId(workspaceId) ||
			(hasWorkspaceRun && (isStartingWorkspaceRun || hasActiveAttachRequest)))
	);
}
