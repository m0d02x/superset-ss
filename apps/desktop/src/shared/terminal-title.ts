/**
 * Turn raw terminal titles (OSC 0/2) into stable tab labels.
 *
 * Agents animate their title. omp writes `π <state> <name>`, where state is a
 * braille spinner frame while working, `>` when idle, `!` when it needs
 * attention, or `:` with animation off — e.g. `π ⠋ Fix login bug`,
 * `π > Fix login bug`. Persisting each frame would rewrite the label ~12×/s,
 * so the decoration is stripped to the session name. Claude Code prefixes
 * `✳ `, which is stripped the same way. omp's `title.icons` setting also
 * prefixes a "title card" icon — a Nerd Font private-use glyph our UI font
 * cannot render (shows as a tofu block) — which is dropped too.
 */

/** Leading agent markers: omp's π, Claude Code's ✳/✻. */
const AGENT_MARKER = /^[π✳✻✶✢·*]\s*/u;

/** omp state glyphs (spinner frames, `>`, `!`, `:`) between marker and name. */
const STATE_GLYPHS = /^[\u2800-\u28ff◐◓◑◒●○◉✓✗⚠!>:]+\s*/u;

/**
 * Leading Nerd Font icons (Unicode private-use areas), e.g. omp title cards
 * `<glyph> DIRTY: Check dirty files`.
 */
const PRIVATE_USE_ICONS =
	/^[\u{E000}-\u{F8FF}\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]+\s*/u;

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
	if (!title) return { kind: "empty", label: "" };
	// Agent signals are read off the raw title: the strip loop below consumes
	// the markers it would otherwise match.
	const isAgent = AGENT_MARKER.test(title) || PRIVATE_USE_ICONS.test(title);
	// Layers may appear in any order (`π ⠋ 󰛖 name`), so strip repeatedly
	// until the head stops shrinking.
	let stripped = title;
	for (;;) {
		const next = stripped
			.replace(AGENT_MARKER, "")
			.replace(STATE_GLYPHS, "")
			.replace(PRIVATE_USE_ICONS, "");
		if (next === stripped) break;
		stripped = next;
	}
	if (!stripped || ONLY_DECORATION.test(stripped))
		return { kind: "empty", label: "" };

	if (isAgent) {
		return stripped.trim()
			? { kind: "agent", label: stripped.trim() }
			: { kind: "empty", label: "" };
	}

	return { kind: "shell", label: stripped };
}
