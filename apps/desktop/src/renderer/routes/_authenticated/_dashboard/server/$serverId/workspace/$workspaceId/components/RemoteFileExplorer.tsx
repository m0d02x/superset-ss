import { cn } from "@superset/ui/utils";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface RemoteFileExplorerProps {
	serverId: string;
	rootPath: string;
	selectedFile: string | null;
	onSelectFile: (path: string) => void;
}

export function RemoteFileExplorer({
	serverId,
	rootPath,
	selectedFile,
	onSelectFile,
}: RemoteFileExplorerProps) {
	return (
		<div className="py-1">
			<div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
				Files
			</div>
			<DirectoryNode
				serverId={serverId}
				path={rootPath}
				name={rootPath.split("/").pop() ?? rootPath}
				depth={0}
				defaultOpen
				selectedFile={selectedFile}
				onSelectFile={onSelectFile}
			/>
		</div>
	);
}

function DirectoryNode({
	serverId,
	path,
	name,
	depth,
	defaultOpen = false,
	selectedFile,
	onSelectFile,
}: {
	serverId: string;
	path: string;
	name: string;
	depth: number;
	defaultOpen?: boolean;
	selectedFile: string | null;
	onSelectFile: (path: string) => void;
}) {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const { data: entries = [] } = electronTrpc.servers.listFiles.useQuery(
		{ id: serverId, path },
		{ enabled: isOpen },
	);

	// Filter hidden files and sort (dirs first)
	const sorted = [...entries]
		.filter((e) => !e.name.startsWith("."))
		.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

	return (
		<div>
			<button
				type="button"
				className="flex w-full items-center gap-1 px-2 py-0.5 text-xs hover:bg-muted/50 transition-colors"
				style={{ paddingLeft: `${depth * 12 + 8}px` }}
				onClick={() => setIsOpen(!isOpen)}
			>
				{isOpen ? (
					<ChevronDown className="size-3 text-muted-foreground" />
				) : (
					<ChevronRight className="size-3 text-muted-foreground" />
				)}
				<Folder className="size-3.5 text-muted-foreground" />
				<span className="truncate">{name}</span>
			</button>

			{isOpen &&
				sorted.map((entry) =>
					entry.isDirectory ? (
						<DirectoryNode
							key={entry.name}
							serverId={serverId}
							path={`${path}/${entry.name}`}
							name={entry.name}
							depth={depth + 1}
							selectedFile={selectedFile}
							onSelectFile={onSelectFile}
						/>
					) : (
						<button
							key={entry.name}
							type="button"
							className={cn(
								"flex w-full items-center gap-1 px-2 py-0.5 text-xs transition-colors",
								selectedFile === `${path}/${entry.name}`
									? "bg-accent text-accent-foreground"
									: "hover:bg-muted/50",
							)}
							style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
							onClick={() => onSelectFile(`${path}/${entry.name}`)}
						>
							<File className="size-3.5 text-muted-foreground" />
							<span className="truncate">{entry.name}</span>
						</button>
					),
				)}
		</div>
	);
}
