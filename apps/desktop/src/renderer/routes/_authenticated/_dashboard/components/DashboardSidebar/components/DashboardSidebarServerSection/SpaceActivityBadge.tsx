import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { AsciiSpinner } from "renderer/screens/main/components/AsciiSpinner";
import type { SpaceActivitySummary } from "shared/server-activity";
import type { ActivePaneStatus } from "shared/tabs-types";

export interface SpaceRowActivity {
	/** Remote tmux activity (server spaces only). */
	remote?: SpaceActivitySummary;
	/** Agent hook status (local spaces), or "review" when a remote program finished unseen. */
	status?: ActivePaneStatus | null;
}

const STATUS_LABEL: Record<ActivePaneStatus, string> = {
	working: "working",
	permission: "needs input",
	review: "done",
};

const STATUS_DOT: Record<ActivePaneStatus, string> = {
	working: "bg-amber-500",
	permission: "bg-red-500",
	review: "bg-green-500",
};

/**
 * Right-aligned activity for a space row: a spinner while a program is
 * producing output, the program name while it sits idle, a colored dot for
 * agent attention states, and the live terminal count.
 */
export function SpaceActivityBadge({ remote, status }: SpaceRowActivity) {
	const isWorking = status === "working" || remote?.state === "working";
	const attention = status && status !== "working" ? status : null;
	const command = remote?.command ?? null;
	const terminalCount = remote?.terminalCount ?? 0;

	if (!isWorking && !attention && !command && terminalCount === 0) {
		return null;
	}

	const description = [
		remote?.title && `“${remote.title}”`,
		command &&
			`${command} ${isWorking ? "producing output" : "running, quiet"}`,
		attention && STATUS_LABEL[attention],
		terminalCount > 0 &&
			`${terminalCount} live terminal${terminalCount === 1 ? "" : "s"}`,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<Tooltip delayDuration={400}>
			<TooltipTrigger asChild>
				<span className="flex shrink-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground tabular-nums">
					{isWorking ? (
						<AsciiSpinner className="text-xs text-amber-500" />
					) : attention ? (
						<span
							className={cn("size-1.5 rounded-full", STATUS_DOT[attention])}
						/>
					) : null}
					{command ? (
						<span
							className={cn(
								"max-w-16 truncate",
								isWorking && "text-foreground/80",
							)}
						>
							{command}
						</span>
					) : attention ? (
						<span>{STATUS_LABEL[attention]}</span>
					) : null}
					{terminalCount > 1 && <span>×{terminalCount}</span>}
				</span>
			</TooltipTrigger>
			<TooltipContent side="right" sideOffset={6}>
				{description || "Idle"}
			</TooltipContent>
		</Tooltip>
	);
}
