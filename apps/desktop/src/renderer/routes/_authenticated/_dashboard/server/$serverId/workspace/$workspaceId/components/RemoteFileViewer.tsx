import { Button } from "@superset/ui/button";
import type React from "react";
import { useEffect, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface RemoteFileViewerProps {
	serverId: string;
	filePath: string;
}

export function RemoteFileViewer({
	serverId,
	filePath,
}: RemoteFileViewerProps) {
	const { data, isLoading } = electronTrpc.servers.readFile.useQuery({
		id: serverId,
		path: filePath,
	});
	const writeMutation = electronTrpc.servers.writeFile.useMutation();
	const utils = electronTrpc.useUtils();

	const [editContent, setEditContent] = useState<string | null>(null);
	const isEditing = editContent !== null;

	// Reset edit state when file changes
	useEffect(() => {
		setEditContent(null);
	}, []);

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
				Loading...
			</div>
		);
	}

	if (data?.error || data?.content === null) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-red-500">
				{data?.error ?? "Failed to read file"}
			</div>
		);
	}

	const handleSave = () => {
		if (editContent === null) return;
		writeMutation.mutate(
			{ id: serverId, path: filePath, content: editContent },
			{
				onSuccess: () => {
					setEditContent(null);
					utils.servers.readFile.invalidate({ id: serverId, path: filePath });
				},
			},
		);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
				<span className="text-xs font-medium truncate">
					{filePath.split("/").pop()}
				</span>
				<span className="text-xs text-muted-foreground truncate ml-auto max-w-96">
					{filePath}
				</span>
				{!isEditing ? (
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-xs shrink-0"
						onClick={() => setEditContent(data?.content ?? "")}
					>
						Edit
					</Button>
				) : (
					<>
						<Button
							size="sm"
							variant="ghost"
							className="h-6 text-xs shrink-0"
							onClick={() => setEditContent(null)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="default"
							className="h-6 text-xs shrink-0"
							onClick={handleSave}
							disabled={writeMutation.isPending}
						>
							{writeMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</>
				)}
			</div>

			{isEditing ? (
				<textarea
					className="flex-1 min-h-0 w-full bg-background p-3 font-mono text-xs resize-none focus:outline-none"
					value={editContent}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
						setEditContent(e.target.value)
					}
					spellCheck={false}
				/>
			) : (
				<pre className="flex-1 min-h-0 overflow-auto p-3 font-mono text-xs leading-relaxed">
					{data?.content}
				</pre>
			)}
		</div>
	);
}
