import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@superset/ui/context-menu";
import { cn } from "@superset/ui/utils";
import { RotateCw, X } from "lucide-react";
import { useRemoteSessionsStore } from "renderer/stores/remote-sessions";

interface RemoteTerminalTabProps {
	label: string;
	isActive: boolean;
	/** Remote shell behind this tab; omit for non-terminal tabs (file viewer). */
	sessionKey?: string;
	onSelect: () => void;
	onClose: () => void;
}

/** Terminal tab with shell health dot and a right-click Reconnect. */
export function RemoteTerminalTab({
	label,
	isActive,
	sessionKey,
	onSelect,
	onClose,
}: RemoteTerminalTabProps) {
	const status = useRemoteSessionsStore((state) =>
		sessionKey ? (state.sessions[sessionKey]?.status ?? null) : null,
	);
	const reconnectSessionByKey = useRemoteSessionsStore(
		(state) => state.reconnectSessionByKey,
	);

	const dot =
		status === "error"
			? { className: "bg-destructive", title: "Shell disconnected" }
			: status === "opening"
				? { className: "animate-pulse bg-amber-500", title: "Opening shell…" }
				: null;

	const reconnect = () => {
		if (!sessionKey) return;
		reconnectSessionByKey(sessionKey).catch((error: unknown) => {
			console.warn("[RemoteTerminalTab] reconnect failed", error);
		});
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					role="tab"
					aria-selected={isActive}
					tabIndex={0}
					className={cn(
						"group flex h-full shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs transition-colors",
						isActive
							? "bg-background text-foreground"
							: "text-muted-foreground hover:bg-background/50 hover:text-foreground",
					)}
					onClick={onSelect}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onSelect();
						}
					}}
				>
					{dot && (
						<span
							className={cn("size-1.5 shrink-0 rounded-full", dot.className)}
							title={dot.title}
						/>
					)}
					<span className="max-w-48 truncate">{label}</span>
					<button
						type="button"
						className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
						onClick={(event) => {
							event.stopPropagation();
							onClose();
						}}
						tabIndex={-1}
						aria-label={`Close ${label}`}
					>
						<X className="size-3" />
					</button>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
				{sessionKey && (
					<>
						<ContextMenuItem onSelect={reconnect} disabled={status === null}>
							<RotateCw className="mr-2 size-3.5" />
							Reconnect shell
						</ContextMenuItem>
						<ContextMenuSeparator />
					</>
				)}
				<ContextMenuItem onSelect={onClose}>
					<X className="mr-2 size-3.5" />
					Close tab
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
