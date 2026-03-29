import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, Plus, Server, Terminal } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface ServerWorkspaceListProps {
	serverId: string;
	initialRepoPath?: string;
}

export function ServerWorkspaceList({
	serverId,
	initialRepoPath,
}: ServerWorkspaceListProps) {
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [repoPath, setRepoPath] = useState(initialRepoPath ?? "");

	return (
		<div className="space-y-4">
			<div className="space-y-1.5">
				<Label htmlFor="repo-path">Repository Path on Server</Label>
				<Input
					id="repo-path"
					placeholder="/root/my-project"
					value={repoPath}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setRepoPath(e.target.value)
					}
				/>
			</div>

			{repoPath ? (
				<>
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-medium">Worktrees</h3>
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-xs"
							onClick={() => setIsCreateOpen(true)}
						>
							<Plus className="mr-1 size-3" />
							New Worktree
						</Button>
					</div>
					<WorktreeList serverId={serverId} repoPath={repoPath} />
					<CreateWorktreeDialog
						open={isCreateOpen}
						onOpenChange={setIsCreateOpen}
						serverId={serverId}
						repoPath={repoPath}
					/>
				</>
			) : (
				<EmptyState />
			)}

			<ServerInfo serverId={serverId} />
		</div>
	);
}

function EmptyState() {
	return (
		<div className="rounded-lg border border-dashed border-border p-4 text-center">
			<GitBranch className="mx-auto mb-2 size-5 text-muted-foreground" />
			<p className="text-xs text-muted-foreground">
				Enter a repo path on the server to manage worktrees
			</p>
		</div>
	);
}

function WorktreeList({
	serverId,
	repoPath,
}: {
	serverId: string;
	repoPath: string;
}) {
	const navigate = useNavigate();
	const { data: worktrees = [], isLoading } =
		electronTrpc.servers.listWorktrees.useQuery(
			{ id: serverId, repoPath },
			{ enabled: !!repoPath },
		);

	if (isLoading) {
		return (
			<p className="text-xs text-muted-foreground py-2">Loading worktrees...</p>
		);
	}

	if (worktrees.length === 0) {
		return (
			<p className="text-xs text-muted-foreground py-2">
				No worktrees found. Create one or check the repo path.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			{worktrees.map((wt) => (
				<button
					key={wt.path}
					type="button"
					className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50"
					onClick={() =>
						navigate({
							to: "/server/$serverId/workspace/$workspaceId",
							params: {
								serverId,
								workspaceId: encodeURIComponent(wt.path),
							},
						})
					}
				>
					<GitBranch className="size-4 text-muted-foreground" />
					<div className="flex-1 min-w-0">
						<div className="text-sm font-medium truncate">{wt.branch}</div>
						<div className="text-xs text-muted-foreground truncate">
							{wt.path}
						</div>
					</div>
					<Terminal className="size-3.5 text-muted-foreground" />
				</button>
			))}
		</div>
	);
}

function ServerInfo({ serverId }: { serverId: string }) {
	const { data: info } = electronTrpc.servers.info.useQuery({ id: serverId });

	if (!info) return null;

	return (
		<div className="rounded-lg border border-border p-3">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<Server className="size-3" />
				<span>Server Info</span>
			</div>
			<div className="mt-2 space-y-1 text-xs">
				<div className="flex justify-between">
					<span className="text-muted-foreground">System</span>
					<span>{info.platform}</span>
				</div>
				<div className="flex justify-between">
					<span className="text-muted-foreground">Hostname</span>
					<span>{info.hostname}</span>
				</div>
				<div className="flex justify-between">
					<span className="text-muted-foreground">Uptime</span>
					<span>{info.uptime}</span>
				</div>
			</div>
		</div>
	);
}

function CreateWorktreeDialog({
	open,
	onOpenChange,
	serverId,
	repoPath,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	serverId: string;
	repoPath: string;
}) {
	const [branch, setBranch] = useState("");
	const [baseBranch, setBaseBranch] = useState("main");
	const utils = electronTrpc.useUtils();

	const createMutation = electronTrpc.servers.createWorktree.useMutation({
		onSuccess: () => {
			utils.servers.listWorktrees.invalidate({ id: serverId, repoPath });
			setBranch("");
			onOpenChange(false);
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		createMutation.mutate({
			id: serverId,
			repoPath,
			branch,
			baseBranch: baseBranch || undefined,
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Create Worktree</DialogTitle>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-3">
						<div className="space-y-1.5">
							<Label htmlFor="wt-branch">Branch Name</Label>
							<Input
								id="wt-branch"
								placeholder="feature/my-branch"
								value={branch}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									setBranch(e.target.value)
								}
								required
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="wt-base">Base Branch</Label>
							<Input
								id="wt-base"
								placeholder="main"
								value={baseBranch}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									setBaseBranch(e.target.value)
								}
							/>
						</div>
					</div>

					{createMutation.error && (
						<p className="text-xs text-red-500">
							{createMutation.error.message}
						</p>
					)}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={!branch || createMutation.isPending}
						>
							{createMutation.isPending ? "Creating..." : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
