import {
	asyncDataLoaderFeature,
	expandAllFeature,
	type ItemInstance,
	selectionFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import { useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuArrowDownToLine, LuFile, LuFolder } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useTabsStore } from "renderer/stores/tabs/store";
import {
	retargetAbsolutePath,
	toRelativeWorkspacePath,
} from "shared/absolute-paths";
import type {
	DirectoryEntry,
	ExternalFileUploadConflictItem,
	ExternalFileUploadConflictResolution,
	ExternalFileUploadSkippedItem,
	FileSystemChangeEvent,
	FileTreeDataAdapter,
} from "shared/file-tree-types";
import {
	type LocalFileTreeDataAdapter,
	useLocalFileTreeAdapter,
} from "./adapters";
import { DeleteConfirmDialog } from "./components/DeleteConfirmDialog";
import { FileSearchResultItem } from "./components/FileSearchResultItem";
import { FileTreeItem } from "./components/FileTreeItem";
import { FileTreeToolbar } from "./components/FileTreeToolbar";
import { NewItemInput } from "./components/NewItemInput";
import { RenameInput } from "./components/RenameInput";
import { UploadConflictDialog } from "./components/UploadConflictDialog";
import { ROW_HEIGHT, TREE_INDENT } from "./constants";
import { useFileSearch } from "./hooks/useFileSearch";
import type { NewItemMode } from "./types";

interface PendingTreeRefresh {
	fullRefresh: boolean;
	directoryPaths: Set<string>;
	invalidateSearch: boolean;
	expandedPathsToRestore: Set<string>;
}

interface FileTreeController {
	getItems(): ItemInstance<DirectoryEntry>[];
	getItemInstance(
		itemId: string,
	): ItemInstance<DirectoryEntry> | null | undefined;
}

interface PendingUploadConflictState {
	targetDirectoryPath: string;
	conflicts: ExternalFileUploadConflictItem[];
	unresolvedFiles: ExternalFileUploadSkippedItem[];
}

function _getEntryRelativePath(rootPath: string, absolutePath: string): string {
	const relativePath = toRelativeWorkspacePath(rootPath, absolutePath);
	return relativePath === "." ? "" : relativePath;
}

function getPathSegmentSeparator(absolutePath: string): string {
	return absolutePath.includes("\\") ? "\\" : "/";
}

export function getParentPath(absolutePath: string): string {
	if (absolutePath === "/" || absolutePath === "\\") {
		return absolutePath;
	}

	const trimmedPath = absolutePath.replace(/[\\/]+$/, "");
	if (trimmedPath.length === 0) {
		return absolutePath.startsWith("\\") ? "\\" : "/";
	}

	const lastSeparatorIndex = Math.max(
		trimmedPath.lastIndexOf("/"),
		trimmedPath.lastIndexOf("\\"),
	);

	if (lastSeparatorIndex <= 0) {
		return trimmedPath.startsWith("\\") ? "\\" : "/";
	}

	// Preserve Windows drive roots like `C:\`.
	if (/^[A-Za-z]:$/.test(trimmedPath.slice(0, lastSeparatorIndex))) {
		return `${trimmedPath.slice(0, lastSeparatorIndex)}\\`;
	}

	return trimmedPath.slice(0, lastSeparatorIndex);
}

function getDropTargetDirectory(
	entry: DirectoryEntry,
	worktreePath: string,
): string {
	return entry.isDirectory
		? entry.path
		: getParentPath(entry.path) || worktreePath;
}

function formatUploadSkippedMessage(
	skipped: ExternalFileUploadSkippedItem[],
): string {
	if (skipped.length === 0) {
		return "";
	}

	if (skipped.length === 1) {
		return skipped[0]?.reason ?? "Upload skipped";
	}

	const firstReason = skipped[0]?.reason ?? "Upload skipped";
	return `${firstReason} (+${skipped.length - 1} more)`;
}

function deleteCachedEntryPath(
	cache: Map<string, DirectoryEntry>,
	absolutePath: string,
): void {
	const segmentSeparator = getPathSegmentSeparator(absolutePath);
	for (const cachedPath of cache.keys()) {
		if (
			cachedPath === absolutePath ||
			cachedPath.startsWith(`${absolutePath}${segmentSeparator}`)
		) {
			cache.delete(cachedPath);
		}
	}
}

function getExpandedRenameTargets(
	tree: FileTreeController,
	oldAbsolutePath: string,
	newAbsolutePath: string,
	isDirectory: boolean,
): string[] {
	if (!isDirectory) {
		return [];
	}

	return tree
		.getItems()
		.filter(
			(item: ItemInstance<DirectoryEntry>) =>
				item.getItemData()?.isDirectory && item.isExpanded(),
		)
		.map((item: ItemInstance<DirectoryEntry>) => item.getItemData()?.path ?? "")
		.filter((path) => path.length > 0)
		.map((path) =>
			retargetAbsolutePath(path, oldAbsolutePath, newAbsolutePath, true),
		)
		.filter((path): path is string => Boolean(path));
}

async function restoreExpandedDirectories(
	tree: FileTreeController,
	paths: Iterable<string>,
): Promise<void> {
	const orderedPaths = Array.from(new Set(paths)).sort(
		(left, right) => left.split(/[/\\]/).length - right.split(/[/\\]/).length,
	);

	for (const path of orderedPaths) {
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const item = tree.getItemInstance(path);
			if (item) {
				if (!item.isExpanded()) {
					await item.expand();
				}
				break;
			}

			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

interface FilesViewProps {
	adapter?: FileTreeDataAdapter;
	rootPath?: string;
	onFileActivate?: (entry: DirectoryEntry) => void;
}

function isLocalFileTreeAdapter(
	adapter: FileTreeDataAdapter,
): adapter is LocalFileTreeDataAdapter {
	return "isDeleting" in adapter;
}

export function FilesView({
	adapter: adapterProp,
	rootPath,
	onFileActivate,
}: FilesViewProps = {}) {
	const { workspaceId } = useParams({ strict: false });
	const { data: workspace } = electronTrpc.workspaces.get.useQuery(
		{ id: workspaceId ?? "" },
		{ enabled: !!workspaceId },
	);
	const worktreePath = rootPath ?? workspace?.worktreePath;

	const [searchTerm, setSearchTerm] = useState("");
	const [showHiddenFiles, setShowHiddenFiles] = useState(false);
	const [rootLoadState, setRootLoadState] = useState<
		"idle" | "loading" | "ready" | "empty" | "error"
	>("idle");
	const [rootLoadError, setRootLoadError] = useState<string | null>(null);
	const projectId = workspace?.project?.id;

	// Refs avoid stale closure in dataLoader callbacks
	const worktreePathRef = useRef(worktreePath);
	worktreePathRef.current = worktreePath;
	const entryCacheRef = useRef(new Map<string, DirectoryEntry>());
	const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingRefreshRef = useRef<PendingTreeRefresh>({
		fullRefresh: false,
		directoryPaths: new Set<string>(),
		invalidateSearch: false,
		expandedPathsToRestore: new Set<string>(),
	});

	const trpcUtils = electronTrpc.useUtils();
	const localAdapter = useLocalFileTreeAdapter({
		workspaceId,
		worktreePath,
		onRefresh: async (parentPath: string) => {
			const isRoot = parentPath === worktreePath;
			const itemId = isRoot
				? "root"
				: tree
						.getItems()
						.find(
							(item: ItemInstance<DirectoryEntry>) =>
								item.getItemData()?.path === parentPath,
						)
						?.getId();
			if (itemId) {
				await tree.getItemInstance(itemId)?.invalidateChildrenIds();
			}
		},
	});
	const adapter = adapterProp ?? localAdapter;
	const supportsCreateActions = Boolean(
		adapter.createFile && adapter.createDirectory,
	);
	const supportsMutationActions = Boolean(
		adapter.rename && adapter.deleteItems,
	);
	const hideSearch = !workspaceId;
	const isDeleting = isLocalFileTreeAdapter(adapter)
		? adapter.isDeleting
		: false;

	const tree = useTree<DirectoryEntry>({
		rootItemId: "root",
		getItemName: (item: ItemInstance<DirectoryEntry>) =>
			item.getItemData()?.name ?? "",
		isItemFolder: (item: ItemInstance<DirectoryEntry>) =>
			item.getItemData()?.isDirectory ?? false,
		dataLoader: {
			getItem: async (itemId: string): Promise<DirectoryEntry> => {
				if (itemId === "root") {
					return {
						id: "root",
						name: "root",
						path: worktreePathRef.current ?? "",
						relativePath: "",
						isDirectory: true,
					};
				}

				const cachedEntry = entryCacheRef.current.get(itemId);
				if (cachedEntry) {
					return cachedEntry;
				}

				const currentPath = worktreePathRef.current;
				const name = itemId.split(/[/\\]/).pop() ?? itemId;
				const relativePath =
					currentPath && itemId.startsWith(currentPath)
						? itemId.slice(currentPath.length).replace(/^[/\\]/, "")
						: itemId;

				return {
					id: itemId,
					name,
					path: itemId,
					relativePath,
					isDirectory: false,
				};
			},
			getChildren: async (itemId: string): Promise<string[]> => {
				const currentPath = worktreePathRef.current;
				if (!currentPath) return [];

				const dirPath = itemId === "root" ? currentPath : itemId;
				if (!dirPath) return [];
				const isRootLoad = itemId === "root";
				if (isRootLoad) {
					setRootLoadState("loading");
					setRootLoadError(null);
				}

				try {
					const nextEntries = (await adapter.getChildren(dirPath)).filter(
						(entry) => showHiddenFiles || !entry.name.startsWith("."),
					);
					for (const entry of nextEntries) {
						entryCacheRef.current.set(entry.path, entry);
					}
					if (isRootLoad) {
						setRootLoadState(nextEntries.length > 0 ? "ready" : "empty");
					}
					return nextEntries.map((entry) => entry.path);
				} catch (error) {
					console.error("[FilesView] Failed to load children:", error);
					if (isRootLoad) {
						setRootLoadState("error");
						setRootLoadError(
							error instanceof Error ? error.message : "Failed to load files",
						);
					}
					return [];
				}
			},
		},
		features: [asyncDataLoaderFeature, selectionFeature, expandAllFeature],
	});

	const prevWorktreePathRef = useRef(worktreePath);
	useEffect(() => {
		if (worktreePath && prevWorktreePathRef.current !== worktreePath) {
			entryCacheRef.current.clear();
			setRootLoadState("loading");
			setRootLoadError(null);
			tree.getItemInstance("root")?.invalidateChildrenIds();
		}
		prevWorktreePathRef.current = worktreePath;
	}, [worktreePath, tree]);

	const refreshVisibleDirectories = useCallback(() => {
		entryCacheRef.current.clear();
		setRootLoadState("loading");
		setRootLoadError(null);
		tree.getItemInstance("root")?.invalidateChildrenIds();
		for (const item of tree.getItems()) {
			if (item.getItemData()?.isDirectory) {
				item.invalidateChildrenIds();
			}
		}
		void trpcUtils.filesystem.searchFiles.invalidate();
	}, [tree, trpcUtils]);

	const invalidateDirectoryByPath = useCallback(
		(directoryPath: string) => {
			const currentRoot = worktreePathRef.current;
			if (!currentRoot) {
				return;
			}

			if (directoryPath === currentRoot) {
				tree.getItemInstance("root")?.invalidateChildrenIds();
				return;
			}

			const directoryItem = tree
				.getItems()
				.find(
					(item: ItemInstance<DirectoryEntry>) =>
						item.getItemData()?.isDirectory &&
						item.getItemData()?.path === directoryPath,
				);
			directoryItem?.invalidateChildrenIds();
		},
		[tree],
	);

	const scheduleRefresh = useCallback(
		(event?: FileSystemChangeEvent) => {
			const currentRoot = worktreePathRef.current;
			if (event) {
				pendingRefreshRef.current.invalidateSearch = true;

				if (event.type === "overflow" || !currentRoot) {
					pendingRefreshRef.current.fullRefresh = true;
				} else if (
					event.type === "rename" &&
					event.absolutePath &&
					event.oldAbsolutePath
				) {
					deleteCachedEntryPath(entryCacheRef.current, event.oldAbsolutePath);
					deleteCachedEntryPath(entryCacheRef.current, event.absolutePath);

					pendingRefreshRef.current.directoryPaths.add(
						getParentPath(event.oldAbsolutePath),
					);
					pendingRefreshRef.current.directoryPaths.add(
						getParentPath(event.absolutePath),
					);

					for (const expandedPath of getExpandedRenameTargets(
						tree,
						event.oldAbsolutePath,
						event.absolutePath,
						Boolean(event.isDirectory),
					)) {
						pendingRefreshRef.current.expandedPathsToRestore.add(expandedPath);
					}
				} else if (event.absolutePath) {
					deleteCachedEntryPath(entryCacheRef.current, event.absolutePath);

					if (event.type !== "update" || event.isDirectory) {
						const parentPath =
							event.absolutePath === currentRoot
								? currentRoot
								: getParentPath(event.absolutePath);
						pendingRefreshRef.current.directoryPaths.add(parentPath);
					}
				}
			}

			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
			}
			refreshTimerRef.current = setTimeout(() => {
				refreshTimerRef.current = null;
				const pending = pendingRefreshRef.current;
				pendingRefreshRef.current = {
					fullRefresh: false,
					directoryPaths: new Set<string>(),
					invalidateSearch: false,
					expandedPathsToRestore: new Set<string>(),
				};

				if (pending.fullRefresh) {
					refreshVisibleDirectories();
					return;
				}

				for (const directoryPath of pending.directoryPaths) {
					invalidateDirectoryByPath(directoryPath);
				}

				if (pending.invalidateSearch) {
					void trpcUtils.filesystem.searchFiles.invalidate();
				}

				void restoreExpandedDirectories(tree, pending.expandedPathsToRestore);
			}, 75);
		},
		[invalidateDirectoryByPath, refreshVisibleDirectories, tree, trpcUtils],
	);

	useEffect(() => {
		return () => {
			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
			}
		};
	}, []);

	const useFileEventsHook = adapter.useFileEvents ?? (() => undefined);
	useFileEventsHook(scheduleRefresh);

	const {
		searchResults,
		isFetching: isSearchFetching,
		hasQuery: isSearching,
	} = useFileSearch({
		workspaceId,
		searchTerm,
		includeHidden: showHiddenFiles,
	});

	const addFileViewerPane = useTabsStore((s) => s.addFileViewerPane);
	const openFileInEditorMutation =
		electronTrpc.external.openFileInEditor.useMutation();

	const [newItemMode, setNewItemMode] = useState<NewItemMode>(null);
	const [newItemParentPath, setNewItemParentPath] = useState<string>("");
	const [renameEntry, setRenameEntry] = useState<DirectoryEntry | null>(null);
	const [deleteEntry, setDeleteEntry] = useState<DirectoryEntry | null>(null);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [pendingUploadConflict, setPendingUploadConflict] =
		useState<PendingUploadConflictState | null>(null);
	const [isResolvingUploadConflict, setIsResolvingUploadConflict] =
		useState(false);
	const [externalDragTargetPath, setExternalDragTargetPath] = useState<
		string | null
	>(null);
	const [isRootExternalDragTarget, setIsRootExternalDragTarget] =
		useState(false);
	const uploadToastIdRef = useRef<string | number | null>(null);
	const supportsExternalUploads = Boolean(adapter.uploadExternalFiles);

	const buildUnresolvedUploadSkips = useCallback(
		(resolvedFiles: Array<{ localPath: string; fileName: string }>) => {
			return resolvedFiles
				.filter((file) => file.localPath.length === 0)
				.map((file) => ({
					localPath: file.fileName || "Unknown file",
					reason: `Could not read dropped file path for ${file.fileName || "file"}`,
				}));
		},
		[],
	);

	const applyUploadResult = useCallback(
		(
			toastId: string | number,
			targetDirectoryPath: string,
			result: {
				uploadedCount: number;
				skipped: ExternalFileUploadSkippedItem[];
				conflicts: ExternalFileUploadConflictItem[];
			},
			unresolvedFiles: ExternalFileUploadSkippedItem[],
		) => {
			deleteCachedEntryPath(entryCacheRef.current, targetDirectoryPath);
			invalidateDirectoryByPath(targetDirectoryPath);
			void trpcUtils.filesystem.searchFiles.invalidate();

			const skipped = [...result.skipped, ...unresolvedFiles];

			if (result.conflicts.length > 0) {
				setPendingUploadConflict({
					targetDirectoryPath,
					conflicts: result.conflicts,
					unresolvedFiles,
				});

				if (result.uploadedCount > 0) {
					toast.success(
						`Uploaded ${result.uploadedCount} file${result.uploadedCount === 1 ? "" : "s"}`,
						{
							id: toastId,
							description: `${result.conflicts.length} conflict${result.conflicts.length === 1 ? " requires" : "s require"} your choice`,
						},
					);
				} else {
					toast.message("Upload needs your choice", {
						id: toastId,
						description: `${result.conflicts.length} conflicting file${result.conflicts.length === 1 ? "" : "s"} already exist remotely`,
					});
				}

				return;
			}

			if (result.uploadedCount > 0) {
				toast.success(
					`Uploaded ${result.uploadedCount} file${result.uploadedCount === 1 ? "" : "s"}`,
					{
						id: toastId,
						description:
							skipped.length > 0
								? formatUploadSkippedMessage(skipped)
								: undefined,
					},
				);
				return;
			}

			toast.error("Upload failed", {
				id: toastId,
				description: formatUploadSkippedMessage(skipped),
			});
		},
		[invalidateDirectoryByPath, trpcUtils],
	);

	const handleFileActivate = useCallback(
		(entry: DirectoryEntry, openInNewTab?: boolean) => {
			if (entry.isDirectory) return;
			if (onFileActivate) {
				onFileActivate(entry);
				return;
			}
			if (!workspaceId || !worktreePath) return;
			addFileViewerPane(workspaceId, {
				filePath: entry.path,
				openInNewTab,
			});
		},
		[workspaceId, worktreePath, addFileViewerPane, onFileActivate],
	);

	const handleOpenInEditor = useCallback(
		(entry: DirectoryEntry) => {
			if (!worktreePath) return;
			openFileInEditorMutation.mutate({
				path: entry.path,
				cwd: worktreePath,
				projectId,
			});
		},
		[worktreePath, projectId, openFileInEditorMutation],
	);

	const handleNewFile = useCallback(
		async (parentPath: string) => {
			if (parentPath !== worktreePath) {
				const item = tree
					.getItems()
					.find(
						(i: ItemInstance<DirectoryEntry>) =>
							i.getItemData()?.path === parentPath,
					);
				if (item && !item.isExpanded()) {
					await item.expand();
				}
			}
			setNewItemMode("file");
			setNewItemParentPath(parentPath);
		},
		[worktreePath, tree],
	);

	const handleNewFolder = useCallback(
		async (parentPath: string) => {
			if (parentPath !== worktreePath) {
				const item = tree
					.getItems()
					.find(
						(i: ItemInstance<DirectoryEntry>) =>
							i.getItemData()?.path === parentPath,
					);
				if (item && !item.isExpanded()) {
					await item.expand();
				}
			}
			setNewItemMode("folder");
			setNewItemParentPath(parentPath);
		},
		[worktreePath, tree],
	);

	const handleNewItemSubmit = useCallback(
		(name: string) => {
			if (newItemMode === "file") {
				void adapter.createFile?.(newItemParentPath, name);
			} else if (newItemMode === "folder") {
				void adapter.createDirectory?.(newItemParentPath, name);
			}
			setNewItemMode(null);
			setNewItemParentPath("");
		},
		[newItemMode, newItemParentPath, adapter],
	);

	const handleNewItemCancel = useCallback(() => {
		setNewItemMode(null);
		setNewItemParentPath("");
	}, []);

	const handleDeleteRequest = useCallback((entry: DirectoryEntry) => {
		setDeleteEntry(entry);
		setShowDeleteDialog(true);
	}, []);

	const handleDeleteConfirm = useCallback(() => {
		if (deleteEntry) {
			void adapter.deleteItems?.([deleteEntry.path]);
		}
		setShowDeleteDialog(false);
		setDeleteEntry(null);
	}, [deleteEntry, adapter]);

	const handleRename = useCallback((entry: DirectoryEntry) => {
		setRenameEntry(entry);
	}, []);

	const handleRenameSubmit = useCallback(
		(newName: string) => {
			if (renameEntry) {
				void adapter.rename?.(renameEntry.path, newName);
			}
			setRenameEntry(null);
		},
		[renameEntry, adapter],
	);

	const handleRenameCancel = useCallback(() => {
		setRenameEntry(null);
	}, []);

	const handleCollapseAll = useCallback(() => {
		tree.collapseAll();
	}, [tree]);

	const handleRefresh = useCallback(() => {
		refreshVisibleDirectories();
	}, [refreshVisibleDirectories]);

	const handleToggleHiddenFiles = useCallback(() => {
		setShowHiddenFiles((previous) => !previous);
	}, []);

	const prevShowHiddenFilesRef = useRef(showHiddenFiles);
	useEffect(() => {
		if (prevShowHiddenFilesRef.current !== showHiddenFiles) {
			refreshVisibleDirectories();
		}
		prevShowHiddenFilesRef.current = showHiddenFiles;
	}, [refreshVisibleDirectories, showHiddenFiles]);

	const uploadExternalFiles = useCallback(
		async (
			targetDirectoryPath: string,
			files: File[],
			conflictResolution: ExternalFileUploadConflictResolution = "skip",
			conflictLocalPaths?: string[],
		) => {
			if (!adapter.uploadExternalFiles) {
				return;
			}

			if (files.length === 0) {
				return;
			}

			const resolvedFiles = files.map((file) => {
				try {
					const localPath = window.webUtils.getPathForFile(file);
					return { localPath, fileName: file.name };
				} catch {
					return { localPath: "", fileName: file.name };
				}
			});

			const localPaths = resolvedFiles
				.map((file) => {
					try {
						return file.localPath;
					} catch {
						return "";
					}
				})
				.filter((path): path is string => path.length > 0);

			const unresolvedFiles = buildUnresolvedUploadSkips(resolvedFiles);

			if (localPaths.length === 0) {
				toast.error("Could not read any dropped files");
				return;
			}

			const toastId = toast.loading(
				`Uploading ${localPaths.length} file${localPaths.length === 1 ? "" : "s"}...`,
			);
			uploadToastIdRef.current = toastId;

			try {
				const result = await adapter.uploadExternalFiles(
					targetDirectoryPath,
					localPaths,
					{
						conflictResolution,
						conflictLocalPaths,
					},
				);
				applyUploadResult(
					toastId,
					targetDirectoryPath,
					result,
					unresolvedFiles,
				);
			} catch (error) {
				toast.error("Upload failed", {
					id: toastId,
					description:
						error instanceof Error ? error.message : "Unexpected upload error",
				});
			}
		},
		[adapter, applyUploadResult, buildUnresolvedUploadSkips],
	);

	const handleUploadConflictDialogOpenChange = useCallback((open: boolean) => {
		if (!open) {
			setPendingUploadConflict(null);
		}
	}, []);

	const handleSkipUploadConflicts = useCallback(() => {
		const skippedCount = pendingUploadConflict?.conflicts.length ?? 0;
		setPendingUploadConflict(null);

		if (skippedCount > 0) {
			toast.message(
				skippedCount === 1
					? "Skipped conflicting upload"
					: `Skipped ${skippedCount} conflicting uploads`,
			);
		}
	}, [pendingUploadConflict]);

	const resolveUploadConflict = useCallback(
		async (
			resolution: Extract<
				ExternalFileUploadConflictResolution,
				"overwrite" | "rename"
			>,
		) => {
			if (!pendingUploadConflict || !adapter.uploadExternalFiles) {
				return;
			}

			setIsResolvingUploadConflict(true);
			const toastId = toast.loading(
				resolution === "overwrite"
					? "Overwriting conflicting uploads..."
					: "Uploading renamed copies...",
			);

			try {
				const localPaths = pendingUploadConflict.conflicts.map(
					(conflict) => conflict.localPath,
				);
				const result = await adapter.uploadExternalFiles(
					pendingUploadConflict.targetDirectoryPath,
					localPaths,
					{
						conflictResolution: resolution,
						conflictLocalPaths: localPaths,
					},
				);

				setPendingUploadConflict(null);
				applyUploadResult(
					toastId,
					pendingUploadConflict.targetDirectoryPath,
					result,
					pendingUploadConflict.unresolvedFiles,
				);
			} catch (error) {
				toast.error("Upload failed", {
					id: toastId,
					description:
						error instanceof Error ? error.message : "Unexpected upload error",
				});
			} finally {
				setIsResolvingUploadConflict(false);
			}
		},
		[adapter, applyUploadResult, pendingUploadConflict],
	);

	const handleRootDragOver = useCallback(
		(event: React.DragEvent) => {
			if (
				!supportsExternalUploads ||
				!event.dataTransfer.types.includes("Files")
			) {
				return;
			}

			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		},
		[supportsExternalUploads],
	);

	const handleRootDragEnter = useCallback(
		(event: React.DragEvent) => {
			if (
				!supportsExternalUploads ||
				!event.dataTransfer.types.includes("Files")
			) {
				return;
			}

			event.preventDefault();
			setIsRootExternalDragTarget(true);
			setExternalDragTargetPath(null);
		},
		[supportsExternalUploads],
	);

	const handleRootDragLeave = useCallback(
		(event: React.DragEvent) => {
			if (
				!supportsExternalUploads ||
				!event.dataTransfer.types.includes("Files")
			) {
				return;
			}

			const nextTarget = event.relatedTarget;
			if (
				nextTarget instanceof Node &&
				event.currentTarget.contains(nextTarget)
			) {
				return;
			}

			setIsRootExternalDragTarget(false);
			setExternalDragTargetPath(null);
		},
		[supportsExternalUploads],
	);

	const handleRootDrop = useCallback(
		(event: React.DragEvent) => {
			if (
				!supportsExternalUploads ||
				!worktreePath ||
				!event.dataTransfer.types.includes("Files")
			) {
				return;
			}

			event.preventDefault();
			setIsRootExternalDragTarget(false);
			setExternalDragTargetPath(null);
			void uploadExternalFiles(
				worktreePath,
				Array.from(event.dataTransfer.files),
			);
		},
		[supportsExternalUploads, uploadExternalFiles, worktreePath],
	);

	const handleItemDragEnterExternalFiles = useCallback(
		(entry: DirectoryEntry) => {
			setExternalDragTargetPath(entry.path);
			setIsRootExternalDragTarget(false);
		},
		[],
	);

	const handleItemDragLeaveExternalFiles = useCallback(
		(entry: DirectoryEntry) => {
			setExternalDragTargetPath((current) =>
				current === entry.path ? null : current,
			);
		},
		[],
	);

	const handleItemDropExternalFiles = useCallback(
		(entry: DirectoryEntry, files: File[]) => {
			if (!worktreePath) {
				return;
			}

			setExternalDragTargetPath(null);
			setIsRootExternalDragTarget(false);
			void uploadExternalFiles(
				getDropTargetDirectory(entry, worktreePath),
				files,
			);
		},
		[uploadExternalFiles, worktreePath],
	);

	const searchResultEntries = useMemo(() => {
		return searchResults.map((result) => ({
			id: result.id,
			name: result.name,
			path: result.path,
			relativePath: result.relativePath,
			isDirectory: result.isDirectory,
		}));
	}, [searchResults]);

	const treeItems = tree
		.getItems()
		.filter((item: ItemInstance<DirectoryEntry>) => item.getId() !== "root");

	if (!worktreePath) {
		return (
			<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
				No workspace selected
			</div>
		);
	}

	return (
		<div className="flex flex-col flex-1 min-h-0">
			<FileTreeToolbar
				searchTerm={searchTerm}
				onSearchChange={setSearchTerm}
				onNewFile={() => handleNewFile(worktreePath)}
				onNewFolder={() => handleNewFolder(worktreePath)}
				onToggleHiddenFiles={handleToggleHiddenFiles}
				onCollapseAll={handleCollapseAll}
				onRefresh={handleRefresh}
				isRefreshing={rootLoadState === "loading"}
				showHiddenFiles={showHiddenFiles}
				hideCreateActions={!supportsCreateActions}
				hideSearch={hideSearch}
			/>

			<div className="flex-1 min-h-0 overflow-hidden">
				<ContextMenu>
					<ContextMenuTrigger asChild className="h-full">
						<div
							role="tree"
							aria-label="Files"
							className={cn(
								"relative h-full overflow-auto",
								isRootExternalDragTarget &&
									"bg-primary/5 ring-1 ring-inset ring-primary/40",
							)}
							onDragOver={handleRootDragOver}
							onDragEnter={handleRootDragEnter}
							onDragLeave={handleRootDragLeave}
							onDrop={handleRootDrop}
						>
							<AnimatePresence initial={false}>
								{isRootExternalDragTarget && (
									<motion.div
										initial={{ opacity: 0, y: -6, scale: 0.98 }}
										animate={{ opacity: 1, y: 0, scale: 1 }}
										exit={{ opacity: 0, y: -6, scale: 0.98 }}
										transition={{ duration: 0.16, ease: "easeOut" }}
										className="sticky top-0 z-10 px-2 pt-2 pointer-events-none"
									>
										<div className="inline-flex items-center gap-1 rounded-sm bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary backdrop-blur-sm">
											<LuArrowDownToLine className="size-3.5" />
											Upload to workspace root
										</div>
									</motion.div>
								)}
							</AnimatePresence>

							{newItemMode && newItemParentPath === worktreePath && (
								<NewItemInput
									mode={newItemMode}
									parentPath={newItemParentPath}
									onSubmit={handleNewItemSubmit}
									onCancel={handleNewItemCancel}
								/>
							)}

							{isSearching ? (
								searchResultEntries.length > 0 ? (
									<div className="flex flex-col">
										{searchResultEntries.map((entry) =>
											renameEntry?.path === entry.path ? (
												<RenameInput
													key={entry.id}
													entry={entry}
													onSubmit={handleRenameSubmit}
													onCancel={handleRenameCancel}
												/>
											) : (
												<FileSearchResultItem
													key={entry.id}
													entry={entry}
													worktreePath={worktreePath}
													projectId={projectId}
													onActivate={handleFileActivate}
													onOpenInEditor={handleOpenInEditor}
													onNewFile={handleNewFile}
													onNewFolder={handleNewFolder}
													onRename={handleRename}
													onDelete={handleDeleteRequest}
													hideCreateActions={!supportsCreateActions}
													hideMutationActions={!supportsMutationActions}
												/>
											),
										)}
									</div>
								) : (
									<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
										{isSearchFetching
											? "Searching files..."
											: "No matching files"}
									</div>
								)
							) : rootLoadState === "error" ? (
								<div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
									<div>Could not load files</div>
									{rootLoadError && (
										<div className="max-w-full truncate text-xs text-muted-foreground/80">
											{rootLoadError}
										</div>
									)}
									<button
										type="button"
										onClick={handleRefresh}
										className="rounded-sm border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
									>
										Refresh
									</button>
								</div>
							) : rootLoadState === "loading" && treeItems.length === 0 ? (
								<div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
									Loading files...
								</div>
							) : rootLoadState === "empty" && treeItems.length === 0 ? (
								<div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
									No files found in this directory
								</div>
							) : (
								<div {...tree.getContainerProps()} className="outline-none">
									{treeItems.map((item: ItemInstance<DirectoryEntry>) => {
										const data = item.getItemData();
										if (!data) return null;
										const showNewItemInput =
											newItemMode &&
											data.isDirectory &&
											data.path === newItemParentPath;
										const isRenaming = renameEntry?.path === data.path;
										return (
											<div key={item.getId()}>
												{isRenaming ? (
													<RenameInput
														entry={data}
														onSubmit={handleRenameSubmit}
														onCancel={handleRenameCancel}
														level={item.getItemMeta().level}
													/>
												) : (
													<FileTreeItem
														item={item}
														entry={data}
														rowHeight={ROW_HEIGHT}
														indent={TREE_INDENT}
														worktreePath={worktreePath}
														projectId={projectId}
														onActivate={handleFileActivate}
														onOpenInEditor={handleOpenInEditor}
														onNewFile={handleNewFile}
														onNewFolder={handleNewFolder}
														onRename={handleRename}
														onDelete={handleDeleteRequest}
														onDragEnterExternalFiles={
															supportsExternalUploads
																? handleItemDragEnterExternalFiles
																: undefined
														}
														onDragLeaveExternalFiles={
															supportsExternalUploads
																? handleItemDragLeaveExternalFiles
																: undefined
														}
														onDropExternalFiles={
															supportsExternalUploads
																? handleItemDropExternalFiles
																: undefined
														}
														isExternalDragTarget={
															externalDragTargetPath === data.path
														}
														hideCreateActions={!supportsCreateActions}
														hideMutationActions={!supportsMutationActions}
													/>
												)}
												{showNewItemInput && (
													<NewItemInput
														mode={newItemMode}
														parentPath={newItemParentPath}
														onSubmit={handleNewItemSubmit}
														onCancel={handleNewItemCancel}
														level={item.getItemMeta().level + 1}
													/>
												)}
											</div>
										);
									})}
								</div>
							)}
						</div>
					</ContextMenuTrigger>
					<ContextMenuContent className="w-48">
						{supportsCreateActions && (
							<>
								<ContextMenuItem onClick={() => handleNewFile(worktreePath)}>
									<LuFile className="mr-2 size-4" />
									New File
								</ContextMenuItem>
								<ContextMenuItem onClick={() => handleNewFolder(worktreePath)}>
									<LuFolder className="mr-2 size-4" />
									New Folder
								</ContextMenuItem>
							</>
						)}
					</ContextMenuContent>
				</ContextMenu>
			</div>

			<DeleteConfirmDialog
				entry={deleteEntry}
				open={showDeleteDialog}
				onOpenChange={setShowDeleteDialog}
				onConfirm={handleDeleteConfirm}
				isDeleting={isDeleting}
				isPermanent={!isLocalFileTreeAdapter(adapter)}
			/>

			<UploadConflictDialog
				conflicts={pendingUploadConflict?.conflicts ?? []}
				open={pendingUploadConflict !== null}
				onOpenChange={handleUploadConflictDialogOpenChange}
				onSkip={handleSkipUploadConflicts}
				onOverwrite={() => void resolveUploadConflict("overwrite")}
				onRename={() => void resolveUploadConflict("rename")}
				isResolving={isResolvingUploadConflict}
			/>
		</div>
	);
}
