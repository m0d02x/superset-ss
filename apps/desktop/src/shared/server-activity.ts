/**
 * Server space activity, derived from the Hyperset tmux socket.
 *
 * One remote command lists every pane; this module turns that text into
 * per-session state. Kept free of Node/Electron imports so it is unit-testable
 * and shareable between main and renderer.
 */

import { normalizeTerminalTitle } from "./terminal-title";

/** Terminal session names look like `ss-<spaceId>-term-<n>`. */
const SESSION_PATTERN = /^ss-(.+)-(term-\d+)$/;

/**
 * Field separator for the tmux format string. A tab never appears in tmux
 * session names or process names, unlike spaces.
 */
export const ACTIVITY_FIELD_SEPARATOR = "\t";

/** tmux `list-panes -F` format matching {@link parseServerActivity}. */
export const SERVER_ACTIVITY_FORMAT = [
	"#{session_name}",
	"#{pane_current_command}",
	"#{window_activity}",
	// Last: a title may itself contain tabs; everything after field 3 is title.
	"#{pane_title}",
].join(ACTIVITY_FIELD_SEPARATOR);

/**
 * Remote command that prints the pane listing followed by the server's clock,
 * so activity timestamps are compared against the server's own time (immune to
 * local/remote clock skew).
 */
export function buildServerActivityCommand(tmux: string): string {
	return `${tmux} list-panes -a -F '${SERVER_ACTIVITY_FORMAT}' 2>/dev/null; printf 'now\\t%s\\n' "$(date +%s)"`;
}

/**
 * Process names that are a plain shell — anything else is a foreground
 * program. Node-based agents (codex, claude) report as `node`, so "not a
 * shell" is the reliable signal rather than an agent allow-list.
 */
const SHELL_COMMANDS: Record<string, true> = {
	bash: true,
	zsh: true,
	sh: true,
	fish: true,
	dash: true,
	ksh: true,
	tcsh: true,
	csh: true,
	login: true,
	"": true,
};

const STATE_RANK: Record<TerminalActivityState, number> = {
	shell: 0,
	running: 1,
	working: 2,
};

/** Output within this window counts as "working". */
export const WORKING_WINDOW_SECONDS = 4;

export type TerminalActivityState = "shell" | "running" | "working";

export interface TerminalActivity {
	terminalId: string;
	/** Foreground program, e.g. `omp`, `node`, `bash`. */
	command: string;
	state: TerminalActivityState;
	/** Seconds since the terminal last produced output. */
	idleSeconds: number;
	/** Agent session title (e.g. omp's session name), when one is set. */
	title: string | null;
}

export interface SpaceActivity {
	spaceId: string;
	terminals: TerminalActivity[];
}

/**
 * Parse {@link buildServerActivityCommand} output into per-space activity.
 * Sessions that are not Hyperset terminals (`ss-<space>-term-<n>`) are ignored.
 */
export function parseServerActivity(output: string): SpaceActivity[] {
	const lines = output.split("\n").filter((line) => line.length > 0);
	const nowLine = lines.find((line) => line.startsWith("now\t"));
	const now = Number(nowLine?.split(ACTIVITY_FIELD_SEPARATOR)[1]);
	if (!Number.isFinite(now)) return [];

	const bySpace = new Map<string, TerminalActivity[]>();
	for (const line of lines) {
		const [sessionName, command = "", activity, ...titleParts] = line.split(
			ACTIVITY_FIELD_SEPARATOR,
		);
		const paneTitle = normalizeTerminalTitle(
			titleParts.join(ACTIVITY_FIELD_SEPARATOR),
		);
		const title = paneTitle.kind === "agent" ? paneTitle.label : null;
		const match = sessionName ? SESSION_PATTERN.exec(sessionName) : null;
		if (!match) continue;
		const [, spaceId, terminalId] = match;
		if (!spaceId || !terminalId) continue;

		const lastActivity = Number(activity);
		const idleSeconds = Number.isFinite(lastActivity)
			? Math.max(0, now - lastActivity)
			: Number.POSITIVE_INFINITY;
		const isShell = SHELL_COMMANDS[command] === true;
		const state: TerminalActivityState = isShell
			? "shell"
			: idleSeconds <= WORKING_WINDOW_SECONDS
				? "working"
				: "running";

		const terminals = bySpace.get(spaceId) ?? [];
		// A session may hold several panes; keep the most active per terminal.
		const existing = terminals.find((t) => t.terminalId === terminalId);
		if (!existing) {
			terminals.push({ terminalId, command, state, idleSeconds, title });
		} else if (STATE_RANK[state] > STATE_RANK[existing.state]) {
			Object.assign(existing, { command, state, idleSeconds, title });
		}
		bySpace.set(spaceId, terminals);
	}

	return Array.from(bySpace, ([spaceId, terminals]) => ({
		spaceId,
		terminals,
	}));
}

/** Summary used by the sidebar row. */
export interface SpaceActivitySummary {
	/** Live tmux terminals in the space. */
	terminalCount: number;
	/** The program to name in the badge (agent/command), if any is running. */
	command: string | null;
	state: TerminalActivityState | null;
	/** Agent session title of that program, e.g. "Fix login bug". */
	title: string | null;
}

export function summarizeSpaceActivity(
	activity: SpaceActivity | undefined,
): SpaceActivitySummary {
	if (!activity || activity.terminals.length === 0) {
		return { terminalCount: 0, command: null, state: null, title: null };
	}
	let top: TerminalActivity | undefined;
	for (const terminal of activity.terminals) {
		if (!top || STATE_RANK[terminal.state] > STATE_RANK[top.state]) {
			top = terminal;
		}
	}
	if (!top || top.state === "shell") {
		return {
			terminalCount: activity.terminals.length,
			command: null,
			state: top?.state ?? null,
			title: null,
		};
	}
	return {
		terminalCount: activity.terminals.length,
		command: top.command,
		state: top.state,
		title: top.title,
	};
}
