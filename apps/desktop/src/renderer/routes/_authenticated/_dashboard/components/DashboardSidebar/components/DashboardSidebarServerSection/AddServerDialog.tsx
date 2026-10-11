import type { SelectServer } from "@superset/local-db";
import type { ServerAuthMethod } from "@superset/local-db/schema/zod";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import type React from "react";
import { useEffect, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getDefaultHomeDirectory } from "shared/space-display";

interface AddServerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	server?: SelectServer;
}

export function AddServerDialog({
	open,
	onOpenChange,
	server,
}: AddServerDialogProps) {
	const utils = electronTrpc.useUtils();
	const isEditing = !!server;
	const [label, setLabel] = useState("");
	const [host, setHost] = useState("");
	const [port, setPort] = useState("22");
	const [username, setUsername] = useState("root");
	const [authMethod, setAuthMethod] = useState<ServerAuthMethod>("key");
	const [sshKeyPath, setSshKeyPath] = useState("~/.ssh/id_ed25519");
	const [homeDirectory, setHomeDirectory] = useState("/root");

	const pickSSHKeyMutation = electronTrpc.servers.pickSSHKey.useMutation();

	const createMutation = electronTrpc.servers.create.useMutation({
		onSuccess: () => {
			utils.servers.list.invalidate();
			resetForm();
			onOpenChange(false);
		},
	});

	const updateMutation = electronTrpc.servers.update.useMutation({
		onSuccess: (updated) => {
			utils.servers.list.invalidate();
			if (updated) {
				utils.servers.get.invalidate({ id: updated.id });
			}
			onOpenChange(false);
		},
	});

	useEffect(() => {
		if (open && server) {
			setLabel(server.label);
			setHost(server.host);
			setPort(String(server.port));
			setUsername(server.username);
			setAuthMethod(server.authMethod ?? "key");
			setSshKeyPath(server.sshKeyPath ?? "~/.ssh/id_ed25519");
			setHomeDirectory(
				server.homeDirectory ?? getDefaultHomeDirectory(server.username),
			);
		}
	}, [open, server]);

	const resetForm = () => {
		setLabel("");
		setHost("");
		setPort("22");
		setUsername("root");
		setAuthMethod("key");
		setSshKeyPath("~/.ssh/id_ed25519");
		setHomeDirectory("/root");
	};

	const isPending = createMutation.isPending || updateMutation.isPending;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		const values = {
			label: label || host,
			host,
			port: Number.parseInt(port, 10) || 22,
			username,
			authMethod,
			sshKeyPath: authMethod === "key" ? sshKeyPath : null,
			homeDirectory: homeDirectory.trim() || null,
		};

		if (server) {
			updateMutation.mutate({ id: server.id, ...values });
		} else {
			createMutation.mutate(values);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEditing ? "Edit Server" : "Add Server"}</DialogTitle>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-3">
						<div className="space-y-1.5">
							<Label htmlFor="server-label">Label</Label>
							<Input
								id="server-label"
								placeholder="My VPS"
								value={label}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									setLabel(e.target.value)
								}
							/>
						</div>

						<div className="grid grid-cols-3 gap-2">
							<div className="col-span-2 space-y-1.5">
								<Label htmlFor="server-host">Host</Label>
								<Input
									id="server-host"
									placeholder="192.168.1.100"
									value={host}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
										setHost(e.target.value)
									}
									required
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="server-port">Port</Label>
								<Input
									id="server-port"
									type="number"
									value={port}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
										setPort(e.target.value)
									}
								/>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-2">
							<div className="space-y-1.5">
								<Label htmlFor="server-username">Username</Label>
								<Input
									id="server-username"
									value={username}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
										const nextUsername = e.target.value;
										const currentDefault = getDefaultHomeDirectory(username);
										setUsername(nextUsername);
										if (!homeDirectory || homeDirectory === currentDefault) {
											setHomeDirectory(getDefaultHomeDirectory(nextUsername));
										}
									}}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="server-authMethod">Auth Method</Label>
								<Select
									value={authMethod}
									onValueChange={(v: string) =>
										setAuthMethod(v as ServerAuthMethod)
									}
								>
									<SelectTrigger id="server-authMethod">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="key">SSH Key</SelectItem>
										<SelectItem value="agent">SSH Agent</SelectItem>
										<SelectItem value="password">Password</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						{authMethod === "key" && (
							<div className="space-y-1.5">
								<Label htmlFor="server-sshKeyPath">SSH Key Path</Label>
								<div className="flex gap-2">
									<Input
										id="server-sshKeyPath"
										placeholder="~/.ssh/id_ed25519"
										value={sshKeyPath}
										onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
											setSshKeyPath(e.target.value)
										}
										className="flex-1"
									/>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={async () => {
											const path = await pickSSHKeyMutation.mutateAsync();
											if (path) setSshKeyPath(path);
										}}
									>
										Browse
									</Button>
								</div>
							</div>
						)}

						<div className="space-y-1.5">
							<Label htmlFor="server-homeDirectory">Base Directory</Label>
							<Input
								id="server-homeDirectory"
								placeholder="/home/ubuntu"
								value={homeDirectory}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									setHomeDirectory(e.target.value)
								}
							/>
							<p className="text-xs text-muted-foreground">
								Space directories are resolved from here. Example: /dev/project
								→ /home/ubuntu/dev/project.
							</p>
						</div>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!host || isPending}>
							{isEditing
								? isPending
									? "Saving..."
									: "Save Changes"
								: isPending
									? "Adding..."
									: "Add Server"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
