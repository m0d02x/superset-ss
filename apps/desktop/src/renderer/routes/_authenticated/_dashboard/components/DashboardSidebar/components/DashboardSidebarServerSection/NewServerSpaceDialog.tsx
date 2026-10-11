import type { SelectServer, SelectServerSpace } from "@superset/local-db";
import { Button } from "@superset/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@superset/ui/dialog";
import { Input } from "@superset/ui/input";
import { Kbd } from "@superset/ui/kbd";
import { Label } from "@superset/ui/label";
import { Spinner } from "@superset/ui/spinner";
import { Switch } from "@superset/ui/switch";
import { cn } from "@superset/ui/utils";
import {
	Check,
	ChevronRight,
	Clock,
	Folder,
	FolderPlus,
	AlertCircle as LuAlertCircle,
	RotateCw,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { HiMiniPlus } from "react-icons/hi2";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { joinRemotePath } from "shared/server-directories";
import { resolveServerSpaceDirectory } from "shared/server-paths";
import {
	directoryName,
	getDefaultHomeDirectory,
	UNTITLED_SPACE_LABEL,
} from "shared/space-display";

/** Collapse an absolute path to `~/…` when it lives under the server home. */
function homeRelative(
	path: string,
	homeDirectory: string | null | undefined,
): string {
	const home = homeDirectory?.trim().replace(/\/+$/, "");
	if (!home) return path;
	if (path === home) return "~";
	return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

interface NewServerSpaceDialogProps {
	server: SelectServer;
	spaces: SelectServerSpace[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Directory to list first: the selected space's folder, or `~`. */
	initialDirectory: string;
	/** Space was created — select and open it. */
	onCreated: (space: SelectServerSpace) => void;
	/** User chose to open an existing space that already points at this folder. */
	onOpenExisting: (spaceId: string) => void;
}

export function NewServerSpaceDialog({
	server,
	spaces,
	open,
	onOpenChange,
	initialDirectory,
	onCreated,
	onOpenExisting,
}: NewServerSpaceDialogProps) {
	const utils = electronTrpc.useUtils();
	const homeDirectory =
		server.homeDirectory ?? getDefaultHomeDirectory(server.username);

	const [pendingPath, setPendingPath] = useState(initialDirectory);
	const [pathInput, setPathInput] = useState(initialDirectory);
	const [cwd, setCwd] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [showHidden, setShowHidden] = useState(false);
	const [selected, setSelected] = useState<number | null>(null);
	const [name, setName] = useState("");
	const [isCreatingFolder, setIsCreatingFolder] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const filterRef = useRef<HTMLInputElement>(null);

	const connected = server.status === "connected";
	const isConnecting = server.status === "connecting";

	const connectMutation = electronTrpc.servers.connect.useMutation();
	const connecting = isConnecting || connectMutation.isPending;

	const listQuery = electronTrpc.servers.listDirectories.useQuery(
		{ id: server.id, path: pendingPath },
		{
			enabled: open && connected,
			retry: false,
			refetchOnWindowFocus: false,
			staleTime: 15_000,
			placeholderData: (previous) => previous,
		},
	);

	const createSpaceMutation = electronTrpc.servers.createSpace.useMutation({
		onSuccess: (space) => {
			utils.servers.listSpaces.invalidate({ serverId: server.id });
			onCreated(space);
			onOpenChange(false);
		},
	});

	const createFolderMutation = electronTrpc.servers.createDirectory.useMutation(
		{
			onSuccess: (_result, variables) => {
				utils.servers.listDirectories.invalidate({ id: server.id });
				openDirectory(variables.path);
				setIsCreatingFolder(false);
				setNewFolderName("");
			},
		},
	);

	// Connect on open so the picker works from a cold server row.
	// Runs on the open transition only, by design — not on every status flip.
	const serverId = server.id;
	const connect = connectMutation.mutate;
	const listDirectories = utils.servers.listDirectories;
	useEffect(() => {
		if (!open) return;
		if (!connected && !connecting) connect({ id: serverId });
	}, [open, connected, connecting, connect, serverId]);

	// First listing once the connection is up.
	useEffect(() => {
		if (open && connected) {
			listDirectories.invalidate({ id: serverId });
		}
	}, [open, connected, listDirectories, serverId]);

	// Reset the picker each time it opens.
	useEffect(() => {
		if (!open) return;
		setPendingPath(initialDirectory);
		setPathInput(initialDirectory);
		setCwd(null);
		setError(null);
		setFilter("");
		setSelected(null);
		setName("");
		setIsCreatingFolder(false);
		setNewFolderName("");
	}, [open, initialDirectory]);

	// Commit the listing: resolved path becomes the current folder.
	useEffect(() => {
		const data = listQuery.data;
		if (!data) return;
		if (data.error || !data.path) {
			setError(data.error ?? "Can't open this folder on the server.");
			return;
		}
		setError(null);
		setCwd(data.path);
		setPathInput(homeRelative(data.path, homeDirectory));
	}, [listQuery.data, homeDirectory]);

	const entries = useMemo(() => {
		const list = listQuery.data?.entries ?? [];
		const visible = showHidden ? list : list.filter((e) => !e.startsWith("."));
		const query = filter.trim().toLowerCase();
		return query
			? visible.filter((entry) => entry.toLowerCase().includes(query))
			: visible;
	}, [listQuery.data, showHidden, filter]);

	useEffect(() => {
		if (selected != null && selected >= entries.length) {
			setSelected(entries.length > 0 ? 0 : null);
		}
	}, [entries, selected]);

	const recentDirectories = useMemo(() => {
		const seen = new Set<string>();
		const recents: string[] = [];
		for (const space of [...spaces].sort((a, b) => b.updatedAt - a.updatedAt)) {
			const absolute = resolveServerSpaceDirectory(
				space.directory,
				homeDirectory,
			);
			if (!absolute || seen.has(absolute) || absolute === cwd) continue;
			seen.add(absolute);
			recents.push(absolute);
		}
		return recents.slice(0, 4);
	}, [spaces, homeDirectory, cwd]);

	const existingSpace = useMemo(() => {
		if (!cwd) return null;
		return (
			spaces.find(
				(space) =>
					resolveServerSpaceDirectory(space.directory, homeDirectory) === cwd,
			) ?? null
		);
	}, [spaces, homeDirectory, cwd]);

	function openDirectory(absolutePath: string) {
		setPendingPath(absolutePath);
		setPathInput(homeRelative(absolutePath, homeDirectory));
		setFilter("");
		setSelected(null);
	}

	const navigateToInput = () => {
		const target = pathInput.trim();
		if (!target) return;
		if (
			target === pathInput &&
			cwd &&
			target === homeRelative(cwd, homeDirectory)
		) {
			return;
		}
		setPendingPath(target);
		setSelected(null);
	};

	const suggestedName = cwd ? (directoryName(cwd) ?? UNTITLED_SPACE_LABEL) : "";

	const canCreate =
		cwd != null && !error && !connecting && !createSpaceMutation.isPending;

	const submit = () => {
		if (!canCreate || !cwd) return;
		createSpaceMutation.mutate({
			serverId: server.id,
			label: name.trim() || suggestedName,
			directory: cwd,
		});
	};

	const handlePathKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Enter") return;
		event.preventDefault();
		navigateToInput();
	};

	const handleFilterKeyDown = (
		event: React.KeyboardEvent<HTMLInputElement>,
	) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (entries.length === 0) return;
			const delta = event.key === "ArrowDown" ? 1 : -1;
			setSelected((current) => {
				const base = current ?? (delta > 0 ? -1 : 0);
				return Math.min(entries.length - 1, Math.max(0, base + delta));
			});
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const target =
				selected != null ? entries[selected] : (entries[0] ?? null);
			if (target && cwd) openDirectory(joinRemotePath(cwd, target));
			return;
		}
		if (event.key === "Escape" && filter) {
			event.stopPropagation();
			setFilter("");
		}
	};

	const handleDialogContentKeyDown = (
		event: React.KeyboardEvent<HTMLDivElement>,
	) => {
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			submit();
		}
	};

	const submitNewFolder = () => {
		const folderName = newFolderName.trim();
		if (!folderName || !cwd) return;
		createFolderMutation.mutate({
			id: server.id,
			path: joinRemotePath(cwd, folderName),
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="max-w-lg gap-0 p-0"
				onKeyDown={handleDialogContentKeyDown}
			>
				<DialogHeader className="gap-1 border-b px-5 py-4 text-left">
					<DialogTitle>New space</DialogTitle>
					<DialogDescription>
						Pick a folder on {server.label} ({server.username}@{server.host})
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3 px-5 py-4">
					<div className="flex items-center gap-2">
						<Input
							aria-label="Folder path on server"
							className="h-8 font-mono text-xs"
							placeholder="~"
							value={pathInput}
							autoFocus
							spellCheck={false}
							onChange={(event) => setPathInput(event.target.value)}
							onKeyDown={handlePathKeyDown}
						/>
						<span className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:flex">
							<Kbd>↵</Kbd> go
						</span>
					</div>

					{cwd && (
						<div className="flex items-center gap-1 overflow-hidden text-xs text-muted-foreground">
							<button
								type="button"
								className="shrink-0 rounded px-1 hover:bg-muted hover:text-foreground"
								onClick={() => openDirectory(homeDirectory || "~")}
							>
								~
							</button>
							{cwd
								.replace(/^\/+/, "")
								.split("/")
								.filter(Boolean)
								.map((segment, index, all) => {
									const absolute = `/${all.slice(0, index + 1).join("/")}`;
									const isLast = index === all.length - 1;
									return (
										<span
											key={absolute}
											className="flex min-w-0 items-center gap-1"
										>
											<span className="text-muted-foreground/50">›</span>
											<button
												type="button"
												disabled={isLast}
												className={cn(
													"truncate rounded px-1 hover:bg-muted hover:text-foreground",
													isLast && "text-foreground",
												)}
												onClick={() => openDirectory(absolute)}
											>
												{segment}
											</button>
										</span>
									);
								})}
						</div>
					)}

					{error && (
						<div className="flex items-center gap-2 text-xs text-destructive">
							<LuAlertCircle className="size-3.5 shrink-0" />
							<span className="min-w-0 flex-1 truncate">{error}</span>
							{connected && (
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-xs"
									onClick={() => listQuery.refetch()}
								>
									<RotateCw className="size-3" />
									Retry
								</Button>
							)}
						</div>
					)}

					<div className="overflow-hidden rounded-md border">
						<div className="flex items-center gap-2 border-b px-2.5 py-1.5">
							<Search className="size-3.5 shrink-0 text-muted-foreground" />
							<input
								ref={filterRef}
								className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
								placeholder="Filter folders"
								value={filter}
								onChange={(event) => setFilter(event.target.value)}
								onKeyDown={handleFilterKeyDown}
							/>
							<span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
								Hidden
								<Switch
									checked={showHidden}
									onCheckedChange={setShowHidden}
									aria-label="Show hidden folders"
								/>
							</span>
						</div>

						<div
							className="max-h-64 overflow-y-auto"
							role="listbox"
							aria-label="Folders"
						>
							{recentDirectories.length > 0 && (
								<div className="border-b bg-muted/30 px-2.5 py-1.5">
									<p className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
										Recent
									</p>
									{recentDirectories.map((absolute) => (
										<button
											key={absolute}
											type="button"
											className="flex h-7 w-full items-center gap-2 rounded px-1.5 text-left text-xs hover:bg-muted"
											onClick={() => openDirectory(absolute)}
										>
											<Clock className="size-3.5 shrink-0 text-muted-foreground" />
											<span className="truncate font-mono">
												{homeRelative(absolute, homeDirectory)}
											</span>
										</button>
									))}
								</div>
							)}

							{connecting ? (
								<div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
									<Spinner className="size-3.5" />
									Connecting to {server.label}…
								</div>
							) : !connected ? (
								<div className="flex h-24 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
									<span>{server.statusMessage ?? "Not connected"}</span>
									<Button
										variant="outline"
										size="sm"
										className="h-7"
										onClick={() => connectMutation.mutate({ id: server.id })}
									>
										<RotateCw className="size-3" />
										Connect
									</Button>
								</div>
							) : listQuery.isPending && !listQuery.data ? (
								<div className="flex flex-col gap-1 p-2">
									{[0, 1, 2].map((index) => (
										<div
											key={index}
											className="h-7 animate-pulse rounded bg-muted"
										/>
									))}
								</div>
							) : entries.length === 0 ? (
								<div className="flex h-20 items-center justify-center px-4 text-center text-xs text-muted-foreground">
									{filter
										? "No folders match."
										: "No subfolders. You can create the space here."}
								</div>
							) : (
								entries.map((entry, index) => {
									const isSelected = selected === index;
									return (
										<button
											key={entry}
											type="button"
											role="option"
											aria-selected={isSelected}
											className={cn(
												"flex h-8 w-full items-center gap-2 px-3 text-left text-sm hover:bg-muted",
												isSelected && "bg-accent/15",
											)}
											onClick={() => setSelected(index)}
											onDoubleClick={() => {
												if (cwd) openDirectory(joinRemotePath(cwd, entry));
											}}
										>
											<Folder className="size-4 shrink-0 text-muted-foreground" />
											<span className="min-w-0 flex-1 truncate">{entry}</span>
											{isSelected && (
												<ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
											)}
										</button>
									);
								})
							)}
						</div>

						<div className="border-t px-2.5 py-1.5">
							{isCreatingFolder ? (
								<div className="flex items-center gap-1.5">
									<Input
										autoFocus
										className="h-6 flex-1 text-xs"
										placeholder="new-folder"
										value={newFolderName}
										spellCheck={false}
										onChange={(event) => setNewFolderName(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												submitNewFolder();
											}
											if (event.key === "Escape") {
												event.stopPropagation();
												setIsCreatingFolder(false);
												setNewFolderName("");
											}
										}}
									/>
									<Button
										variant="ghost"
										size="icon"
										className="size-6"
										disabled={
											!newFolderName.trim() || createFolderMutation.isPending
										}
										onClick={submitNewFolder}
									>
										<Check className="size-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="size-6"
										onClick={() => {
											setIsCreatingFolder(false);
											setNewFolderName("");
										}}
									>
										<X className="size-3.5" />
									</Button>
								</div>
							) : (
								<button
									type="button"
									className="flex h-6 w-full items-center gap-1.5 rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
									disabled={!cwd || !connected}
									onClick={() => setIsCreatingFolder(true)}
								>
									<FolderPlus className="size-3.5" />
									New folder here
								</button>
							)}
							{createFolderMutation.isError && (
								<p className="mt-1 truncate text-[10px] text-destructive">
									{createFolderMutation.error.message}
								</p>
							)}
						</div>
					</div>

					<div className="flex items-center gap-3">
						<Label
							htmlFor="new-space-name"
							className="shrink-0 text-xs text-muted-foreground"
						>
							Name (optional)
						</Label>
						<Input
							id="new-space-name"
							className="h-8 flex-1 text-sm"
							placeholder={suggestedName}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</div>

					{existingSpace && (
						<div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
							<LuAlertCircle className="size-3.5 shrink-0" />
							<span className="min-w-0 flex-1 truncate">
								Already open as “{existingSpace.label}”
							</span>
							<Button
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-xs"
								onClick={() => {
									onOpenExisting(existingSpace.id);
									onOpenChange(false);
								}}
							>
								Open
							</Button>
						</div>
					)}
				</div>

				<div className="flex items-center gap-3 border-t px-5 py-3.5">
					<span
						className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
						title={cwd ?? undefined}
					>
						{cwd ?? "—"}
					</span>
					<Button
						variant="outline"
						size="sm"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button size="sm" disabled={!canCreate} onClick={submit}>
						{createSpaceMutation.isPending ? (
							<Spinner className="size-3.5" />
						) : (
							<HiMiniPlus className="size-3.5" />
						)}
						Create space
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
