import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import { type RefObject, useEffect } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	DEFAULT_TERMINAL_FONT_FAMILY,
	DEFAULT_TERMINAL_FONT_SIZE,
} from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/config";

/**
 * Terminal font from Settings → Appearance (Nerd Font stack by default, so
 * prompt themes like Oh My Posh render their icons). Returns the current font
 * for constructing xterm and live-applies changes to the terminal in
 * `terminalRef`.
 */
export function useTerminalFont(
	terminalRef: RefObject<XTerm | null>,
	fitAddonRef: RefObject<FitAddon | null>,
): { fontFamily: string; fontSize: number } {
	const { data: fontSettings } = electronTrpc.settings.getFontSettings.useQuery(
		undefined,
		{ staleTime: 30_000 },
	);
	const fontFamily =
		fontSettings?.terminalFontFamily || DEFAULT_TERMINAL_FONT_FAMILY;
	const fontSize = fontSettings?.terminalFontSize ?? DEFAULT_TERMINAL_FONT_SIZE;

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) return;
		if (
			terminal.options.fontFamily === fontFamily &&
			terminal.options.fontSize === fontSize
		) {
			return;
		}
		terminal.options.fontFamily = fontFamily;
		terminal.options.fontSize = fontSize;
		fitAddonRef.current?.fit();
	}, [fitAddonRef, fontFamily, fontSize, terminalRef]);

	return { fontFamily, fontSize };
}
