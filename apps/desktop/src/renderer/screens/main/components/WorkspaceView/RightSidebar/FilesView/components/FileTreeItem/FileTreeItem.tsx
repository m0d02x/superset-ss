import type { ItemInstance } from "@headless-tree/core";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { cn } from "@superset/ui/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
	LuChevronDown,
	LuChevronRight,
	LuClipboard,
	LuCopy,
	LuCornerDownLeft,
	LuExternalLink,
	LuFile,
	LuFolder,
	LuFolderOpen,
	LuPencil,
	LuTrash2,
} from "react-icons/lu";
import type { DirectoryEntry } from "shared/file-tree-types";
import { useFileDrag, usePathActions } from "../../../ChangesView/hooks";
import { FileIcon } from "../../utils";
import { activateTreeEntry } from "../../utils/folder-activation";

interface FileTreeItemProps {
	item: ItemInstance<DirectoryEntry>;
	entry: DirectoryEntry;
	rowHeight: number;
	indent: number;
	worktreePath: string;
	projectId?: string;
	onActivate: (entry: DirectoryEntry, openInNewTab?: boolean) => void;
	onOpenInEditor: (entry: DirectoryEntry) => void;
	onNewFile: (parentPath: string) => void;
	onNewFolder: (parentPath: string) => void;
	onRename: (entry: DirectoryEntry) => void;
	onDelete: (entry: DirectoryEntry) => void;
	onDragEnterExternalFiles?: (entry: DirectoryEntry) => void;
	onDragLeaveExternalFiles?: (entry: DirectoryEntry) => void;
	onDropExternalFiles?: (entry: DirectoryEntry, files: File[]) => void;
	isExternalDragTarget?: boolean;
	hideCreateActions?: boolean;
	hideMutationActions?: boolean;
}

export function FileTreeItem({
	item,
	entry,
	rowHeight,
	indent,
	worktreePath,
	projectId,
	onActivate,
	onOpenInEditor,
	onNewFile,
	onNewFolder,
	onRename,
	onDelete,
	onDragEnterExternalFiles,
	onDragLeaveExternalFiles,
	onDropExternalFiles,
	isExternalDragTarget = false,
	hideCreateActions = false,
	hideMutationActions = false,
}: FileTreeItemProps) {
	const isFolder = entry.isDirectory;
	const isExpanded = item.isExpanded();
	const level = item.getItemMeta().level;
	const showParentFolderHint = isExternalDragTarget && !isFolder;

	const parentPath = isFolder
		? entry.path
		: entry.path.split("/").slice(0, -1).join("/") || worktreePath;

	const { copyPath, copyRelativePath, revealInFinder, openInEditor } =
		usePathActions({
			absolutePath: entry.path,
			relativePath: entry.relativePath,
			cwd: worktreePath,
			projectId,
		});

	const fileDragProps = useFileDrag({ absolutePath: entry.path });

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isFolder) {
			if (isExpanded) {
				item.collapse();
			} else {
				item.expand();
			}
		} else if (e.metaKey || e.ctrlKey) {
			onOpenInEditor(entry);
		} else {
			onActivate(entry);
		}
	};

	const handleDoubleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		activateTreeEntry({
			isDirectory: isFolder,
			isExpanded,
			item,
			onOpenInEditor: () => onOpenInEditor(entry),
		});
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			if (isFolder) {
				if (isExpanded) {
					item.collapse();
				} else {
					item.expand();
				}
			} else {
				onActivate(entry, e.metaKey || e.ctrlKey ? true : undefined);
			}
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		if (!onDropExternalFiles || !e.dataTransfer.types.includes("Files")) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "copy";
	};

	const handleDragEnter = (e: React.DragEvent) => {
		if (!onDragEnterExternalFiles || !e.dataTransfer.types.includes("Files")) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		onDragEnterExternalFiles(entry);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		if (!onDragLeaveExternalFiles || !e.dataTransfer.types.includes("Files")) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		const nextTarget = e.relatedTarget;
		if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) {
			return;
		}
		onDragLeaveExternalFiles(entry);
	};

	const handleDrop = (e: React.DragEvent) => {
		if (!onDropExternalFiles || !e.dataTransfer.types.includes("Files")) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		onDropExternalFiles(entry, Array.from(e.dataTransfer.files));
	};

	const itemContent = (
		<div
			{...item.getProps()}
			{...fileDragProps}
			data-item-id={item.getId()}
			style={{
				height: rowHeight,
				paddingLeft: level * indent,
			}}
			role="treeitem"
			tabIndex={0}
			aria-expanded={isFolder ? isExpanded : undefined}
			className={cn(
				"flex items-center gap-1 px-1 cursor-pointer select-none",
				"hover:bg-accent/50 transition-colors",
				item.isSelected() && "bg-accent",
				isExternalDragTarget &&
					(isFolder
						? "bg-primary/10 ring-1 ring-inset ring-primary/40"
						: "bg-primary/5 text-foreground"),
			)}
			onClick={handleClick}
			onDoubleClick={handleDoubleClick}
			onKeyDown={handleKeyDown}
			onDragOver={handleDragOver}
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<span className="flex items-center justify-center w-4 h-4 shrink-0">
				{isFolder ? (
					isExpanded ? (
						<LuChevronDown className="size-3.5 text-muted-foreground" />
					) : (
						<LuChevronRight className="size-3.5 text-muted-foreground" />
					)
				) : null}
			</span>

			<FileIcon
				fileName={entry.name}
				isDirectory={isFolder}
				isOpen={isExpanded}
				className={cn(
					"size-4 shrink-0",
					isExternalDragTarget && isFolder && "text-primary",
				)}
			/>

			<span className="flex-1 min-w-0 text-xs truncate">{entry.name}</span>

			<AnimatePresence initial={false}>
				{showParentFolderHint && (
					<motion.span
						initial={{ opacity: 0, x: 4, scale: 0.96 }}
						animate={{ opacity: 1, x: 0, scale: 1 }}
						exit={{ opacity: 0, x: 4, scale: 0.96 }}
						transition={{ duration: 0.14, ease: "easeOut" }}
						className="inline-flex items-center gap-1 shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
					>
						<LuCornerDownLeft className="size-3" />
						To folder
					</motion.span>
				)}
			</AnimatePresence>
		</div>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{itemContent}</ContextMenuTrigger>
			<ContextMenuContent className="w-48">
				{!hideCreateActions && (
					<>
						<ContextMenuItem onClick={() => onNewFile(parentPath)}>
							<LuFile className="mr-2 size-4" />
							New File
						</ContextMenuItem>
						<ContextMenuItem onClick={() => onNewFolder(parentPath)}>
							<LuFolder className="mr-2 size-4" />
							New Folder
						</ContextMenuItem>

						<ContextMenuSeparator />
					</>
				)}

				<ContextMenuItem onClick={copyPath}>
					<LuClipboard className="mr-2 size-4" />
					Copy Path
				</ContextMenuItem>
				<ContextMenuItem onClick={copyRelativePath}>
					<LuCopy className="mr-2 size-4" />
					Copy Relative Path
				</ContextMenuItem>

				<ContextMenuSeparator />

				<ContextMenuItem onClick={revealInFinder}>
					<LuFolderOpen className="mr-2 size-4" />
					Reveal in Finder
				</ContextMenuItem>
				<ContextMenuItem onClick={openInEditor}>
					<LuExternalLink className="mr-2 size-4" />
					Open in Editor
				</ContextMenuItem>

				{!hideMutationActions && (
					<>
						<ContextMenuSeparator />

						<ContextMenuItem onClick={() => onRename(entry)}>
							<LuPencil className="mr-2 size-4" />
							Rename
						</ContextMenuItem>
						<ContextMenuItem
							onClick={() => onDelete(entry)}
							className="text-destructive focus:text-destructive"
						>
							<LuTrash2 className="mr-2 size-4" />
							Delete
						</ContextMenuItem>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}
