import { GitBranch } from "lucide-react";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface RemoteGitStatusProps {
	serverId: string;
	repoPath: string;
}

export function RemoteGitStatus({ serverId, repoPath }: RemoteGitStatusProps) {
	const { data, isLoading } = electronTrpc.servers.gitStatus.useQuery({
		id: serverId,
		path: repoPath,
	});

	if (isLoading) {
		return (
			<p className="text-xs text-muted-foreground">Loading git status...</p>
		);
	}

	if (data?.error) {
		return <p className="text-xs text-red-500">{data.error}</p>;
	}

	const files = data?.files ?? [];

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<GitBranch className="size-4 text-muted-foreground" />
				<h3 className="text-sm font-medium">Changes</h3>
				{files.length > 0 && (
					<span className="text-xs text-muted-foreground">
						({files.length} file{files.length !== 1 ? "s" : ""})
					</span>
				)}
			</div>

			{files.length === 0 ? (
				<p className="text-xs text-muted-foreground">Working tree clean</p>
			) : (
				<div className="space-y-1">
					{files.map((file) => (
						<div
							key={file.path}
							className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-muted/50"
						>
							<StatusBadge status={file.status} />
							<span className="truncate font-mono">{file.path}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const colors: Record<string, string> = {
		M: "text-amber-500",
		A: "text-emerald-500",
		D: "text-red-500",
		"?": "text-muted-foreground",
		U: "text-purple-500",
	};
	const color = colors[status] ?? "text-muted-foreground";

	return (
		<span className={`font-mono font-bold w-4 text-center ${color}`}>
			{status}
		</span>
	);
}
