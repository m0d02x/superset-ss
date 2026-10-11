/**
 * Turn raw terminal titles (OSC 0/2) into stable tab labels.
 *
 * Agents animate their title. omp writes `π <state> <name>`, where state is a
 * braille spinner frame while working, `>` when idle, `!` when it needs
 * attention, or `:` with animation off — e.g. `π ⠋ Fix login bug`,
 * `π > Fix login bug`. Persisting each frame would rewrite the label ~12×/s,
 * so the decoration is stripped to the session name. Claude Code prefixes
 * `✳ `, which is stripped the same way.
 */

/** Leading agent markers: omp's π, Claude Code's ✳/✻. */
const AGENT_MARKER = /^[π✳✻✶✢·*]\s*/u;

/** omp state glyphs (spinner frames, `>`, `!`, `:`) between marker and name. */
const STATE_GLYPHS = /^[\u2800-\u28ff◐◓◑◒●○◉✓✗⚠!>:]+\s*/u;

/** Bare marker titles (`π`, `π ⠋`, `π >`) carry no session name. */
const ONLY_DECORATION = /^[π✳✻✶✢·*\u2800-\u28ff◐◓◑◒●○◉✓✗⚠!>\s:]*$/u;

export type TerminalTitleKind =
	/** An agent's session title, e.g. from omp/Claude/Codex. */
	| "agent"
	/** A shell prompt title (folder name, `user@host: path`). */
	| "shell"
	/** Nothing usable (empty or decoration only). */
	| "empty";

export interface NormalizedTerminalTitle {
	kind: TerminalTitleKind;
	label: string;
}

/**
 * Classify and clean a raw terminal title.
 *
 * A title counts as an agent title when it carries an agent marker (π, ✳).
 * Everything else is treated as a shell title, which callers should only use
 * while no agent title has been seen.
 */
export function normalizeTerminalTitle(raw: string): NormalizedTerminalTitle {
	const title = raw.trim();
	if (!title || ONLY_DECORATION.test(title))
		return { kind: "empty", label: "" };

	if (AGENT_MARKER.test(title)) {
		const label = title
			.replace(AGENT_MARKER, "")
			.replace(STATE_GLYPHS, "")
			.trim();
		return label ? { kind: "agent", label } : { kind: "empty", label: "" };
	}

	return { kind: "shell", label: title };
}
