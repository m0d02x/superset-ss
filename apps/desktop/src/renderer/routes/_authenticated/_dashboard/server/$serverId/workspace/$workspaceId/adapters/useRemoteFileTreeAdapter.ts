import { useCallback, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { toRelativeWorkspacePath } from "shared/absolute-paths";
import type {
	DirectoryEntry,
	FileTreeDataAdapter,
} from "shared/file-tree-types";

interface UseRemoteFileTreeAdapterParams {
	serverId: string;
	rootPath: string | undefined;
}

function joinRemotePath(parentPath: string, childName: string): string {
	const trimmedParentPath = parentPath.replace(/\/+$/, "");
	return trimmedParentPath.length > 0
		? `${trimmedParentPath}/${childName}`
		: `/${childName}`;
}

function toRelativePath(rootPath: string, absolutePath: string): string {
	const relativePath = toRelativeWorkspacePath(rootPath, absolutePath);
	return relativePath === "." ? "" : relativePath;
}

export function useRemoteFileTreeAdapter({
	serverId,
	rootPath,
}: UseRemoteFileTreeAdapterParams): FileTreeDataAdapter {
	const trpcUtils = electronTrpc.useUtils();

	const getChildren = useCallback(
		async (path: string): Promise<DirectoryEntry[]> => {
			if (!rootPath) {
				return [];
			}

			const entries = await trpcUtils.servers.listFiles.fetch({
				id: serverId,
				path,
			});

			return entries
				.filter((entry) => !entry.name.startsWith("."))
				.map((entry) => {
					const absolutePath = joinRemotePath(path, entry.name);
					return {
						id: absolutePath,
						name: entry.name,
						path: absolutePath,
						relativePath: toRelativePath(rootPath, absolutePath),
						isDirectory: entry.isDirectory,
					};
				})
				.sort((left, right) => {
					if (left.isDirectory !== right.isDirectory) {
						return left.isDirectory ? -1 : 1;
					}
					return left.name.localeCompare(right.name);
				});
		},
		[rootPath, serverId, trpcUtils],
	);

	return useMemo(
		() => ({
			getChildren,
		}),
		[getChildren],
	);
}
