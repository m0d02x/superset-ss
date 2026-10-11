import type { SelectServer } from "@superset/local-db";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";

import { Input } from "@superset/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { FolderOpen, Palette, Pencil, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HiChevronRight, HiMiniPlus, HiMiniXMark } from "react-icons/hi2";
import { LuPlug, LuTrash2, LuUnplug } from "react-icons/lu";
import { CloseSpaceDialog } from "./CloseSpaceDialog";
import {
	SpaceActivityBadge,
	type SpaceRowActivity,
} from "./SpaceActivityBadge";

function StatusDot({ status }: { status: SelectServer["status"] }) {
	const colors: Record<string, string> = {
		connected: "bg-emerald-500",
		connecting: "bg-amber-500 animate-pulse",
		error: "bg-red-500",
		disconnected: "bg-neutral-400",
	};

	return (
		<span
			className={cn(
				"inline-block size-1.5 rounded-full shrink-0",
				colors[status] ?? colors.disconnected,
			)}
		/>
	);
}

interface ServerGroupRowProps {
	server: SelectServer;
	isCollapsed: boolean;
	spaceCount: number;
	/** Shown while collapsed so activity stays visible. */
	collapsedActivity?: SpaceRowActivity;
	/** Disambiguates servers that share a label, e.g. `ubuntu@139.99.62.4`. */
	hostHint?: string;
	onToggleCollapse: () => void;
	onAddSpace: () => void;
	onConnect: () => void;
	onDisconnect: () => void;
	onEdit: () => void;
	onDelete: () => void;
	isConnecting: boolean;
}

export function ServerGroupRow({
	server,
	isCollapsed,
	spaceCount,
	collapsedActivity,
	hostHint,
	onToggleCollapse,
	onAddSpace,
	onConnect,
	onDisconnect,
	onEdit,
	onDelete,
	isConnecting,
}: ServerGroupRowProps) {
	const row = (
		<div className="group flex min-h-10 w-full items-center pl-3 pr-2 py-2 text-sm font-medium hover:bg-muted/50 transition-colors">
			<button
				type="button"
				onClick={() => {
					onToggleCollapse();
					if (server.status === "disconnected" && !isConnecting) {
						onConnect();
					}
				}}
				className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
			>
				<StatusDot status={server.status} />
				<span className="truncate">{server.label}</span>
				{hostHint && (
					<span className="truncate text-xs font-normal text-muted-foreground">
						{hostHint}
					</span>
				)}
				<span className="text-xs font-normal tabular-nums text-muted-foreground">
					({spaceCount})
				</span>
				{isCollapsed && collapsedActivity && (
					<span className="ml-auto font-normal">
						<SpaceActivityBadge {...collapsedActivity} />
					</span>
				)}
			</button>

			<Tooltip delayDuration={500}>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onAddSpace();
						}}
						onContextMenu={(event) => event.stopPropagation()}
						className="p-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
					>
						<HiMiniPlus className="size-4 text-muted-foreground" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="bottom" sideOffset={4}>
					New space
				</TooltipContent>
			</Tooltip>

			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onToggleCollapse();
				}}
				onContextMenu={(event) => event.stopPropagation()}
				aria-expanded={!isCollapsed}
				className="p-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
			>
				<HiChevronRight
					className={cn(
						"size-3.5 text-muted-foreground transition-transform duration-150",
						!isCollapsed && "rotate-90",
					)}
				/>
			</button>
		</div>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
			<ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
				{server.status === "connected" ? (
					<ContextMenuItem onSelect={onDisconnect}>
						<LuUnplug className="size-4 mr-2" />
						Disconnect
					</ContextMenuItem>
				) : (
					<ContextMenuItem onSelect={onConnect} disabled={isConnecting}>
						<LuPlug className="size-4 mr-2" />
						{isConnecting ? "Connecting…" : "Connect"}
					</ContextMenuItem>
				)}
				<ContextMenuSeparator />
				<ContextMenuItem onSelect={onEdit}>
					<Pencil className="size-4 mr-2" />
					Edit Connection
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					onSelect={onDelete}
					className="text-destructive focus:text-destructive"
				>
					<LuTrash2 className="size-4 mr-2 text-destructive" />
					Delete Server
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

interface LocalServerRowProps {
	isCollapsed: boolean;
	spaceCount: number;
	isActive: boolean;
	collapsedActivity?: SpaceRowActivity;
	onToggleCollapse: () => void;
	onAddSpace: () => void;
}

export function LocalServerRow({
	isCollapsed,
	spaceCount,
	isActive,
	collapsedActivity,
	onToggleCollapse,
	onAddSpace,
}: LocalServerRowProps) {
	return (
		<div className="border-b border-border last:border-b-0">
			<div
				className={cn(
					"group flex min-h-10 w-full items-center pl-3 pr-2 py-2 text-sm font-medium transition-colors",
					isActive
						? "bg-background text-foreground"
						: "hover:bg-muted/50 text-foreground",
				)}
			>
				<button
					type="button"
					onClick={onToggleCollapse}
					className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
				>
					<SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
					<span className="truncate">Local</span>
					<span className="text-xs font-normal tabular-nums text-muted-foreground">
						({spaceCount})
					</span>
					{isCollapsed && collapsedActivity && (
						<span className="ml-auto font-normal">
							<SpaceActivityBadge {...collapsedActivity} />
						</span>
					)}
				</button>

				<Tooltip delayDuration={500}>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onAddSpace();
							}}
							className="p-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
						>
							<HiMiniPlus className="size-4 text-muted-foreground" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={4}>
						New local space
					</TooltipContent>
				</Tooltip>

				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						onToggleCollapse();
					}}
					aria-expanded={!isCollapsed}
					className="p-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
				>
					<HiChevronRight
						className={cn(
							"size-3.5 text-muted-foreground transition-transform duration-150",
							!isCollapsed && "rotate-90",
						)}
					/>
				</button>
			</div>
		</div>
	);
}

const SPACE_COLORS = [
	{ name: "Red", value: "#ef4444" },
	{ name: "Orange", value: "#f97316" },
	{ name: "Amber", value: "#f59e0b" },
	{ name: "Green", value: "#22c55e" },
	{ name: "Teal", value: "#14b8a6" },
	{ name: "Blue", value: "#3b82f6" },
	{ name: "Indigo", value: "#6366f1" },
	{ name: "Purple", value: "#a855f7" },
	{ name: "Pink", value: "#ec4899" },
] as const;

interface ServerSpaceItemProps {
	/** Display label (custom name, or folder-derived). */
	label: string;
	/** The name the user typed, used to prefill rename. Empty when unnamed. */
	customLabel: string;
	/** Raw directory as entered (editable value). */
	directory?: string;
	/** Compact path shown under the label, e.g. `~/dev/claix-dev`. */
	displayDirectory?: string;
	/** Full resolved path, shown on hover. */
	fullDirectory?: string;
	color?: string;
	isActive: boolean;
	activity?: SpaceRowActivity;
	/** Live terminals that closing would end; > 0 asks for confirmation. */
	runningTerminalCount: number;
	onSelect: () => void;
	onClose: () => void;
	onSetDirectory: (directory: string | undefined) => void;
	onRename: (label: string) => void;
	onColorChange: (color: string | null) => void;
}

export function ServerSpaceItem({
	label,
	customLabel,
	directory,
	displayDirectory,
	fullDirectory,
	color,
	isActive,
	activity,
	runningTerminalCount,
	onSelect,
	onClose,
	onSetDirectory,
	onRename,
	onColorChange,
}: ServerSpaceItemProps) {
	const [isEditingDirectory, setIsEditingDirectory] = useState(false);
	const [directoryValue, setDirectoryValue] = useState(directory ?? "");
	const inputRef = useRef<HTMLInputElement | null>(null);

	const [isRenamingLabel, setIsRenamingLabel] = useState(false);
	const [renameValue, setRenameValue] = useState(customLabel);
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	const [isConfirmingClose, setIsConfirmingClose] = useState(false);

	useEffect(() => {
		if (!isEditingDirectory) {
			setDirectoryValue(directory ?? "");
		}
	}, [directory, isEditingDirectory]);

	useEffect(() => {
		if (!isEditingDirectory) {
			return;
		}

		const timer = setTimeout(() => {
			if (inputRef.current) {
				inputRef.current.focus();
				inputRef.current.select();
			}
		}, 100);

		return () => clearTimeout(timer);
	}, [isEditingDirectory]);

	useEffect(() => {
		if (!isRenamingLabel) {
			return;
		}

		const timer = setTimeout(() => {
			if (renameInputRef.current) {
				renameInputRef.current.focus();
				renameInputRef.current.select();
			}
		}, 100);

		return () => clearTimeout(timer);
	}, [isRenamingLabel]);

	const submitDirectory = () => {
		onSetDirectory(directoryValue.trim() || undefined);
		setIsEditingDirectory(false);
	};

	const cancelDirectoryEdit = () => {
		setDirectoryValue(directory ?? "");
		setIsEditingDirectory(false);
	};

	const submitRename = () => {
		if (!renameValue.trim()) {
			cancelRename();
			return;
		}
		onRename(renameValue.trim());
		setIsRenamingLabel(false);
	};

	const cancelRename = () => {
		setRenameValue(customLabel);
		setIsRenamingLabel(false);
	};

	const startRename = () => {
		if (isEditingDirectory) {
			cancelDirectoryEdit();
		}
		setRenameValue(customLabel);
		setIsRenamingLabel(true);
	};

	const startDirectoryEdit = () => {
		setDirectoryValue(directory ?? "");
		setIsEditingDirectory(true);
	};

	const requestClose = () => {
		if (runningTerminalCount > 0) {
			setIsConfirmingClose(true);
			return;
		}
		onClose();
	};

	const directoryLine = displayDirectory ? (
		<span
			className="truncate text-xs leading-tight text-muted-foreground"
			title={fullDirectory}
		>
			{displayDirectory}
		</span>
	) : null;

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						className={cn(
							"relative flex w-full items-start pl-6 pr-2 text-left text-sm transition-colors group hover:bg-muted/50",
							isActive && "bg-muted",
						)}
					>
						{isActive && (
							<div
								className="absolute top-0 bottom-0 left-0 w-0.5 rounded-r bg-foreground"
								style={color ? { backgroundColor: color } : undefined}
							/>
						)}

						<span
							className={cn(
								"mt-[13px] mr-2.5 size-2 shrink-0 rounded-full",
								!color && "border border-muted-foreground/50",
							)}
							style={color ? { backgroundColor: color } : undefined}
						/>

						<div className="flex min-w-0 flex-1 items-start gap-1.5 py-2">
							{isEditingDirectory ? (
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<Input
										ref={inputRef}
										variant="ghost"
										value={directoryValue}
										onChange={(event) => setDirectoryValue(event.target.value)}
										onBlur={submitDirectory}
										onKeyDown={(event) => {
											event.stopPropagation();
											if (event.key === "Enter") {
												event.preventDefault();
												submitDirectory();
											} else if (event.key === "Escape") {
												event.preventDefault();
												cancelDirectoryEdit();
											}
										}}
										onClick={(event) => event.stopPropagation()}
										onMouseDown={(event) => event.stopPropagation()}
										placeholder="dev/project"
										className="h-7 px-1 py-0 text-[13px] -ml-1"
									/>
									<span className="text-[11px] text-muted-foreground leading-tight">
										Relative paths use the server base directory
									</span>
								</div>
							) : isRenamingLabel ? (
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<Input
										ref={renameInputRef}
										variant="ghost"
										value={renameValue}
										onChange={(event) => setRenameValue(event.target.value)}
										onBlur={submitRename}
										onKeyDown={(event) => {
											event.stopPropagation();
											if (event.key === "Enter") {
												event.preventDefault();
												submitRename();
											} else if (event.key === "Escape") {
												event.preventDefault();
												cancelRename();
											}
										}}
										onClick={(event) => event.stopPropagation()}
										onMouseDown={(event) => event.stopPropagation()}
										placeholder="Space name"
										className="h-7 px-1 py-0 text-[13px] -ml-1"
									/>
									{directoryLine}
								</div>
							) : (
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<button
										type="button"
										onClick={onSelect}
										onDoubleClick={(event) => {
											event.stopPropagation();
											startRename();
										}}
										// The ::after layer stretches the click target over the
										// whole row; row controls sit above it with `relative z-10`.
										className="flex min-w-0 items-center gap-2 text-left after:absolute after:inset-0 after:content-['']"
									>
										<span
											className={cn(
												"min-w-0 flex-1 truncate text-[13px] leading-tight",
												isActive
													? "font-medium text-foreground"
													: "text-foreground/80",
											)}
										>
											{label}
										</span>
										<SpaceActivityBadge {...activity} />
									</button>
									{activity?.remote?.title && (
										<span
											className="truncate text-xs leading-tight text-foreground/70"
											title={activity.remote.title}
										>
											{activity.remote.title}
										</span>
									)}
									{directoryLine ?? (
										<button
											type="button"
											onClick={(event) => {
												event.stopPropagation();
												startDirectoryEdit();
											}}
											className="relative z-10 w-fit text-left text-xs leading-tight text-muted-foreground/70 hover:text-foreground"
										>
											Set directory…
										</button>
									)}
								</div>
							)}
						</div>

						<div className="invisible relative z-10 ml-1 flex items-center pt-2 opacity-0 transition-[opacity,visibility] group-hover:visible group-hover:opacity-100">
							<Tooltip delayDuration={300}>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={(event) => {
											event.stopPropagation();
											requestClose();
										}}
										className="flex items-center justify-center text-muted-foreground hover:text-foreground"
									>
										<HiMiniXMark className="size-3.5" />
									</button>
								</TooltipTrigger>
								<TooltipContent side="top" sideOffset={4}>
									Close space
								</TooltipContent>
							</Tooltip>
						</div>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					<ContextMenuItem onSelect={startRename}>
						<Pencil className="mr-2 size-4" />
						Rename
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onSelect={startDirectoryEdit}>
						<FolderOpen className="mr-2 size-4" />
						{directory ? "Change Directory" : "Set Directory"}
					</ContextMenuItem>
					{directory && (
						<ContextMenuItem onSelect={() => onSetDirectory(undefined)}>
							<HiMiniXMark className="mr-2 size-4" />
							Clear Directory
						</ContextMenuItem>
					)}
					<ContextMenuSeparator />
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<Palette className="mr-2 size-4" />
							Color
						</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							<div className="grid grid-cols-5 gap-1 p-1.5">
								{SPACE_COLORS.map((c) => (
									<button
										key={c.value}
										type="button"
										onClick={() => onColorChange(c.value)}
										className={cn(
											"size-5 rounded-full transition-transform hover:scale-110",
											color === c.value &&
												"ring-2 ring-foreground ring-offset-1 ring-offset-background",
										)}
										style={{ backgroundColor: c.value }}
										title={c.name}
									/>
								))}
							</div>
							{color && (
								<>
									<ContextMenuSeparator />
									<ContextMenuItem onSelect={() => onColorChange(null)}>
										<HiMiniXMark className="mr-2 size-4" />
										Remove Color
									</ContextMenuItem>
								</>
							)}
						</ContextMenuSubContent>
					</ContextMenuSub>
				</ContextMenuContent>
			</ContextMenu>
			<CloseSpaceDialog
				spaceLabel={label}
				terminalCount={runningTerminalCount}
				open={isConfirmingClose}
				onOpenChange={setIsConfirmingClose}
				onConfirm={onClose}
			/>
		</>
	);
}
