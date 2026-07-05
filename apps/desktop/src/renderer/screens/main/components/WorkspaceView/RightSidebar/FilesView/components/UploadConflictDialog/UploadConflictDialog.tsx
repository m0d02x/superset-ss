import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superset/ui/alert-dialog";
import { Button } from "@superset/ui/button";
import type { ExternalFileUploadConflictItem } from "shared/file-tree-types";

interface UploadConflictDialogProps {
	conflicts: ExternalFileUploadConflictItem[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSkip: () => void;
	onOverwrite: () => void;
	onRename: () => void;
	isResolving?: boolean;
}

export function UploadConflictDialog({
	conflicts,
	open,
	onOpenChange,
	onSkip,
	onOverwrite,
	onRename,
	isResolving = false,
}: UploadConflictDialogProps) {
	if (conflicts.length === 0) {
		return null;
	}

	const firstConflict = conflicts[0];
	const title =
		conflicts.length === 1
			? `File already exists: "${firstConflict?.fileName ?? "file"}"`
			: `${conflicts.length} files already exist`;
	const description =
		conflicts.length === 1
			? "Choose whether to replace the remote file or upload a renamed copy."
			: "Choose whether to replace the existing remote files or upload renamed copies for the conflicting files.";

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="max-w-[360px] gap-0 p-0">
				<AlertDialogHeader className="px-4 pt-4 pb-2">
					<AlertDialogTitle className="font-medium">{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="px-4 pb-2 text-xs text-muted-foreground">
					<div className="max-h-28 space-y-1 overflow-auto rounded-md bg-muted/40 px-3 py-2">
						{conflicts.map((conflict) => (
							<div key={`${conflict.localPath}:${conflict.existingPath}`}>
								{conflict.fileName}
							</div>
						))}
					</div>
				</div>

				<AlertDialogFooter className="px-4 pb-4 pt-2 flex-row justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={onSkip}
						disabled={isResolving}
					>
						Skip conflicts
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={onRename}
						disabled={isResolving}
					>
						{isResolving ? "Uploading..." : "Keep both"}
					</Button>
					<Button
						variant="default"
						size="sm"
						className="h-7 px-3 text-xs"
						onClick={onOverwrite}
						disabled={isResolving}
					>
						Overwrite
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
