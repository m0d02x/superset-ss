import { toast } from "@superset/ui/sonner";
import { useCallback, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { toRelativeWorkspacePath } from "shared/absolute-paths";
import type {
	DirectoryEntry,
	ExternalFileUploadOptions,
	ExternalFileUploadResult,
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
	const writeFileMutation = electronTrpc.servers.writeFile.useMutation();
	const createDirectoryMutation =
		electronTrpc.servers.createDirectory.useMutation();
	const renamePathMutation = electronTrpc.servers.renamePath.useMutation();
	const deletePathsMutation = electronTrpc.servers.deletePaths.useMutation();
	const uploadFilesMutation = electronTrpc.servers.uploadFiles.useMutation();

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

	const createFile = useCallback(
		async (parentPath: string, name: string): Promise<void> => {
			await writeFileMutation.mutateAsync({
				id: serverId,
				path: joinRemotePath(parentPath, name),
				content: "",
			});
		},
		[serverId, writeFileMutation],
	);

	const createDirectory = useCallback(
		async (parentPath: string, name: string): Promise<void> => {
			await createDirectoryMutation.mutateAsync({
				id: serverId,
				path: joinRemotePath(parentPath, name),
			});
		},
		[createDirectoryMutation, serverId],
	);

	const rename = useCallback(
		async (absolutePath: string, newName: string): Promise<void> => {
			const parentPath = absolutePath.split("/").slice(0, -1).join("/") || "/";
			const destinationPath = joinRemotePath(parentPath, newName);
			const result = await renamePathMutation.mutateAsync({
				id: serverId,
				sourcePath: absolutePath,
				destinationPath,
			});

			if (!result.success) {
				throw new Error(result.error || "Failed to rename path");
			}

			toast.success(`Renamed to ${newName}`);
		},
		[renamePathMutation, serverId],
	);

	const deleteItems = useCallback(
		async (absolutePaths: string[]): Promise<void> => {
			const result = await deletePathsMutation.mutateAsync({
				id: serverId,
				paths: absolutePaths,
			});

			if (result.deleted.length > 0) {
				toast.success(
					result.deleted.length === 1
						? "Deleted"
						: `Deleted ${result.deleted.length} items`,
				);
			}

			if (result.failed.length > 0) {
				throw new Error(result.failed[0]?.error || "Failed to delete item");
			}
		},
		[deletePathsMutation, serverId],
	);

	const uploadExternalFiles = useCallback(
		async (
			targetDirectoryPath: string,
			localPaths: string[],
			options?: ExternalFileUploadOptions,
		): Promise<ExternalFileUploadResult> => {
			const result = await uploadFilesMutation.mutateAsync({
				id: serverId,
				targetPath: targetDirectoryPath,
				localPaths,
				conflictResolution: options?.conflictResolution,
				conflictLocalPaths: options?.conflictLocalPaths,
			});

			return {
				targetDirectoryPath,
				uploadedCount: result.uploaded.length,
				skipped: result.skipped,
				conflicts: result.conflicts,
			};
		},
		[serverId, uploadFilesMutation],
	);

	return useMemo(
		() => ({
			getChildren,
			createFile,
			createDirectory,
			rename,
			deleteItems,
			uploadExternalFiles,
		}),
		[
			createDirectory,
			createFile,
			deleteItems,
			getChildren,
			rename,
			uploadExternalFiles,
		],
	);
}
