import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { useNavigate } from "@tanstack/react-router";
import type React from "react";
import { useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface RemoteServerTabProps {
	onError: (error: string) => void;
}

export function RemoteServerTab({ onError }: RemoteServerTabProps) {
	const navigate = useNavigate();
	const { data: servers = [] } = electronTrpc.servers.list.useQuery();
	const [selectedServerId, setSelectedServerId] = useState("");
	const [repoUrl, setRepoUrl] = useState("");
	const [repoPath, setRepoPath] = useState("/root");
	const [isCloning, setIsCloning] = useState(false);

	const utils = electronTrpc.useUtils();

	const connectedServers = servers.filter((s) => s.status === "connected");
	const disconnectedServers = servers.filter((s) => s.status !== "connected");

	const connectMutation = electronTrpc.servers.connect.useMutation({
		onSuccess: () => {
			utils.servers.list.invalidate();
		},
	});

	const execMutation = electronTrpc.servers.exec.useMutation();
	const createRemoteProject =
		electronTrpc.projects.createRemoteProject.useMutation();
	const syncWorktrees = electronTrpc.servers.syncWorktrees.useMutation();

	const handleCloneRemote = async () => {
		if (!selectedServerId) {
			onError("Please select a server");
			return;
		}
		if (!repoUrl.trim()) {
			onError("Please enter a repository URL");
			return;
		}

		setIsCloning(true);
		try {
			// Derive repo name from URL
			const repoName = repoUrl
				.trim()
				.replace(/\.git$/, "")
				.split("/")
				.pop();
			const targetPath = `${repoPath.replace(/\/$/, "")}/${repoName}`;

			const result = await execMutation.mutateAsync({
				id: selectedServerId,
				command: `git clone ${JSON.stringify(repoUrl.trim())} ${JSON.stringify(targetPath)} 2>&1`,
			});

			if (result.code !== 0 && !result.stdout.includes("already exists")) {
				onError(`Clone failed: ${result.stdout || result.stderr}`);
				return;
			}

			// Get default branch from remote
			const branchResult = await execMutation.mutateAsync({
				id: selectedServerId,
				command: `cd ${JSON.stringify(targetPath)} && git symbolic-ref --short HEAD 2>/dev/null || echo main`,
			});
			const defaultBranch = branchResult.stdout.trim() || "main";

			// Create project record so it appears in sidebar
			const { project } = await createRemoteProject.mutateAsync({
				serverId: selectedServerId,
				remoteRepoPath: targetPath,
				name: repoName ?? undefined,
				defaultBranch,
			});

			// Sync worktrees so they show in sidebar
			await syncWorktrees.mutateAsync({
				serverId: selectedServerId,
				projectId: project.id,
			});

			// Invalidate sidebar data
			utils.servers.list.invalidate();

			// Navigate back to main view
			navigate({ to: "/" });
		} catch (err) {
			onError(err instanceof Error ? err.message : "Clone failed");
		} finally {
			setIsCloning(false);
		}
	};

	return (
		<div className="flex flex-col gap-5">
			<div>
				<label
					htmlFor="remote-server"
					className="block text-sm font-medium text-foreground mb-2"
				>
					Server
				</label>
				{servers.length === 0 ? (
					<p className="text-xs text-muted-foreground py-2">
						No servers configured. Add one from the sidebar first.
					</p>
				) : (
					<Select
						value={selectedServerId}
						onValueChange={(v: string) => setSelectedServerId(v)}
					>
						<SelectTrigger id="remote-server">
							<SelectValue placeholder="Select a server" />
						</SelectTrigger>
						<SelectContent>
							{connectedServers.map((s) => (
								<SelectItem key={s.id} value={s.id}>
									<span className="inline-block size-1.5 rounded-full bg-emerald-500 mr-2" />
									{s.label} ({s.username}@{s.host})
								</SelectItem>
							))}
							{disconnectedServers.map((s) => (
								<SelectItem key={s.id} value={s.id}>
									<span className="inline-block size-1.5 rounded-full bg-neutral-400 mr-2" />
									{s.label} ({s.username}@{s.host})
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}

				{selectedServerId &&
					servers.find((s) => s.id === selectedServerId)?.status !==
						"connected" && (
						<Button
							variant="outline"
							size="sm"
							className="mt-2"
							onClick={() => connectMutation.mutate({ id: selectedServerId })}
							disabled={connectMutation.isPending}
						>
							{connectMutation.isPending
								? "Connecting..."
								: "Connect to server"}
						</Button>
					)}
			</div>

			<div>
				<label
					htmlFor="remote-repo-url"
					className="block text-sm font-medium text-foreground mb-2"
				>
					Repository URL
				</label>
				<Input
					id="remote-repo-url"
					value={repoUrl}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setRepoUrl(e.target.value)
					}
					placeholder="https://github.com/user/repo.git"
					disabled={isCloning}
				/>
			</div>

			<div>
				<label
					htmlFor="remote-repo-path"
					className="block text-sm font-medium text-foreground mb-2"
				>
					Clone to (on server)
				</label>
				<Input
					id="remote-repo-path"
					value={repoPath}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
						setRepoPath(e.target.value)
					}
					placeholder="/root"
					disabled={isCloning}
				/>
			</div>

			<div className="flex justify-end pt-2 border-t border-border/40">
				<Button
					onClick={handleCloneRemote}
					disabled={
						isCloning ||
						!selectedServerId ||
						!repoUrl.trim() ||
						servers.find((s) => s.id === selectedServerId)?.status !==
							"connected"
					}
					size="sm"
				>
					{isCloning ? "Cloning on server..." : "Clone on Server"}
				</Button>
			</div>
		</div>
	);
}
