import type { IClipboardProvider } from "@xterm/addon-clipboard";
import type { Terminal as XTerm } from "@xterm/xterm";

/**
 * OSC 52 clipboard provider for xterm's ClipboardAddon.
 *
 * tmux (`set-clipboard on`) and most remote apps emit `OSC 52 ; ; <base64>`
 * with an EMPTY selection field. The addon's default provider only honours
 * `c`, so those copies were silently dropped and nothing reached the local
 * clipboard. A terminal has one local clipboard: every write target
 * (`''`, `c`, `p`, `s`, ...) goes to it. Reads stay limited to `c`, as in the
 * default provider.
 */
export const systemClipboardProvider = {
	async readText(selection: string): Promise<string> {
		if (selection !== "c") return "";
		return navigator.clipboard.readText();
	},
	async writeText(_selection: string, text: string): Promise<void> {
		await navigator.clipboard.writeText(text);
	},
} satisfies IClipboardProvider;

/** Terminals pad lines with spaces; drop them so pasted text is clean. */
export function trimSelectionLines(selection: string): string {
	return selection
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n");
}

/**
 * Copy the selection to the system clipboard as soon as it is made
 * (iTerm-style copy-on-select). Returns a cleanup function.
 */
export function setupCopyOnSelect(
	xterm: XTerm,
	write: (text: string) => Promise<void> | void = (text) =>
		navigator.clipboard.writeText(text),
): () => void {
	let lastCopied = "";

	const disposable = xterm.onSelectionChange(() => {
		if (!xterm.hasSelection()) return;
		const text = trimSelectionLines(xterm.getSelection());
		if (!text || text === lastCopied) return;
		lastCopied = text;
		void Promise.resolve(write(text)).catch(() => {
			// Clipboard can be denied while the window is unfocused; let the
			// next selection change retry.
			lastCopied = "";
		});
	});

	return () => disposable.dispose();
}
