import { useCallback, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useWorkspaceFileEvents } from "renderer/screens/main/components/WorkspaceView/hooks/useWorkspaceFileEvents";
import { toRelativeWorkspacePath } from "shared/absolute-paths";
import type {
	DirectoryEntry,
	FileSystemChangeEvent,
	FileTreeDataAdapter,
} from "shared/file-tree-types";
import { useFileTreeActions } from "../hooks/useFileTreeActions";

interface UseLocalFileTreeAdapterParams {
	workspaceId: string | undefined;
	worktreePath: string | undefined;
	onRefresh?: (path: string) => void | Promise<void>;
}

export interface LocalFileTreeDataAdapter extends FileTreeDataAdapter {
	isDeleting: boolean;
}

function getEntryRelativePath(rootPath: string, absolutePath: string): string {
	const relativePath = toRelativeWorkspacePath(rootPath, absolutePath);
	return relativePath === "." ? "" : relativePath;
}

function createUseLocalFileEvents(
	workspaceId: string | undefined,
	worktreePath: string | undefined,
): (onEvent: (event: FileSystemChangeEvent) => void) => void {
	function useLocalFileEvents(
		onEvent: (event: FileSystemChangeEvent) => void,
	): void {
		useWorkspaceFileEvents(
			workspaceId ?? "",
			onEvent,
			Boolean(workspaceId && worktreePath),
		);
	}

	return useLocalFileEvents;
}

export function useLocalFileTreeAdapter({
	workspaceId,
	worktreePath,
	onRefresh,
}: UseLocalFileTreeAdapterParams): LocalFileTreeDataAdapter {
	const trpcUtils = electronTrpc.useUtils();
	const refresh = onRefresh ?? (() => undefined);
	const { createFile, createDirectory, rename, deleteItems, isDeleting } =
		useFileTreeActions({
			workspaceId,
			worktreePath,
			onRefresh: refresh,
		});

	const getChildren = useCallback(
		async (path: string): Promise<DirectoryEntry[]> => {
			if (!workspaceId || !worktreePath) {
				return [];
			}

			const { entries } = await trpcUtils.filesystem.listDirectory.fetch({
				workspaceId,
				absolutePath: path,
			});

			return entries.map((entry) => ({
				id: entry.absolutePath,
				name: entry.name,
				path: entry.absolutePath,
				relativePath: getEntryRelativePath(worktreePath, entry.absolutePath),
				isDirectory: entry.kind === "directory",
			}));
		},
		[trpcUtils, workspaceId, worktreePath],
	);

	const createFileAction = useCallback(
		async (parentPath: string, name: string): Promise<void> => {
			createFile(parentPath, name);
		},
		[createFile],
	);

	const createDirectoryAction = useCallback(
		async (parentPath: string, name: string): Promise<void> => {
			createDirectory(parentPath, name);
		},
		[createDirectory],
	);

	const renameAction = useCallback(
		async (absolutePath: string, newName: string): Promise<void> => {
			rename(absolutePath, newName);
		},
		[rename],
	);

	const deleteItemsAction = useCallback(
		async (absolutePaths: string[]): Promise<void> => {
			deleteItems(absolutePaths);
		},
		[deleteItems],
	);

	const useFileEvents = useMemo(
		() => createUseLocalFileEvents(workspaceId, worktreePath),
		[workspaceId, worktreePath],
	);

	return useMemo(
		() => ({
			getChildren,
			createFile: createFileAction,
			createDirectory: createDirectoryAction,
			rename: renameAction,
			deleteItems: deleteItemsAction,
			useFileEvents,
			isDeleting,
		}),
		[
			getChildren,
			createFileAction,
			createDirectoryAction,
			renameAction,
			deleteItemsAction,
			useFileEvents,
			isDeleting,
		],
	);
}
