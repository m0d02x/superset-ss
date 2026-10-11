/** Bounds match the font-size setting's validation (settings router). */
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 24;

export type TerminalZoomAction = "in" | "out" | "reset";

/**
 * Next terminal font size for a View-menu zoom step. Returns `null` for
 * "reset" (clears the override so the default applies) and when a step would
 * leave the allowed range (no-op at the bounds).
 */
export function nextTerminalFontSize(
	action: TerminalZoomAction,
	current: number,
): number | null {
	if (action === "reset") return null;
	const next = action === "in" ? current + 1 : current - 1;
	return Math.min(
		MAX_TERMINAL_FONT_SIZE,
		Math.max(MIN_TERMINAL_FONT_SIZE, next),
	);
}
