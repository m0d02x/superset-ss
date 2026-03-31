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
	onToggleCollapse: () => void;
	onAddSpace: () => void;
	onConnect: () => void;
	onDisconnect: () => void;
	onDelete: () => void;
	isConnecting: boolean;
}

export function ServerGroupRow({
	server,
	isCollapsed,
	spaceCount,
	onToggleCollapse,
	onAddSpace,
	onConnect,
	onDisconnect,
	onDelete,
	isConnecting,
}: ServerGroupRowProps) {
	const row = (
		// biome-ignore lint/a11y/noStaticElementInteractions: The header acts as a single toggle target while preserving nested inline controls.
		<div
			role="button"
			tabIndex={0}
			onClick={() => {
				onToggleCollapse();
				if (server.status === "disconnected" && !isConnecting) {
					onConnect();
				}
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onToggleCollapse();
					if (server.status === "disconnected" && !isConnecting) {
						onConnect();
					}
				}
			}}
			className="group flex min-h-10 w-full items-center pl-3 pr-2 py-2 text-sm font-medium hover:bg-muted/50 transition-colors"
		>
			<div className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
				<StatusDot status={server.status} />
				<span className="truncate">{server.label}</span>
				<span className="text-xs font-normal tabular-nums text-muted-foreground">
					({spaceCount})
				</span>
			</div>

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
	serverId: string;
	spaceId: string;
	label: string;
	directory?: string;
	color?: string;
	isActive: boolean;
	onSelect: () => void;
	onClose: () => void;
	onSetDirectory: (directory: string | undefined) => void;
	onRename: (label: string) => void;
	onColorChange: (color: string | null) => void;
}

export function ServerSpaceItem({
	serverId: _serverId,
	spaceId: _spaceId,
	label,
	directory,
	color,
	isActive,
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
	const [renameValue, setRenameValue] = useState(label);
	const renameInputRef = useRef<HTMLInputElement | null>(null);

	const isValidDirectory = (value: string) =>
		!value.trim() ||
		value.trim().startsWith("/") ||
		value.trim().startsWith("~");

	const shortenDirectory = (path: string) => {
		const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
		if (parts.length <= 2) return path;
		return `/${parts.slice(-2).join("/")}`;
	};

	const isInputInvalid =
		isEditingDirectory && !isValidDirectory(directoryValue);

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
		if (!isValidDirectory(directoryValue)) return;
		onSetDirectory(directoryValue || undefined);
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
		setRenameValue(label);
		setIsRenamingLabel(false);
	};

	const startRename = () => {
		if (isEditingDirectory) {
			cancelDirectoryEdit();
		}
		setRenameValue(label);
		setIsRenamingLabel(true);
	};

	return (
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

					<SquareTerminal
							className="mt-2.5 size-4 mr-2 shrink-0 text-muted-foreground"
							style={color ? { color } : undefined}
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
									placeholder="~/path/to/project"
									className={cn(
										"h-7 px-1 py-0 text-[13px] -ml-1",
										isInputInvalid && "ring-1 ring-destructive",
									)}
								/>
								{isInputInvalid && (
									<span className="text-[11px] text-destructive leading-tight">
										Must start with / or ~
									</span>
								)}
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
								{directory && (
									<span className="truncate text-xs text-muted-foreground leading-tight">
										{shortenDirectory(directory)}
									</span>
								)}
							</div>
						) : (
							<button
								type="button"
								onClick={onSelect}
								onDoubleClick={(event) => {
									event.stopPropagation();
									startRename();
								}}
								className="flex min-w-0 flex-1 flex-col gap-1 text-left"
							>
								<span
									className={cn(
										"truncate text-[13px] leading-tight",
										isActive
											? "text-foreground font-medium"
											: "text-foreground/80",
									)}
								>
									{label}
								</span>
								{directory && (
									<span className="truncate text-xs text-muted-foreground leading-tight">
										{shortenDirectory(directory)}
									</span>
								)}
							</button>
						)}
					</div>

					<div className="invisible flex items-center justify-end gap-1.5 opacity-0 transition-[opacity,visibility] group-hover:visible group-hover:opacity-100">
						<Tooltip delayDuration={300}>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										onClose();
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
			<ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
				<ContextMenuItem onSelect={startRename}>
					<Pencil className="mr-2 size-4" />
					Rename
				</ContextMenuItem>
				<ContextMenuSeparator />
				<ContextMenuItem
					onSelect={() => {
						setDirectoryValue(directory ?? "");
						setIsEditingDirectory(true);
					}}
				>
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
										color === c.value && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
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
	);
}
