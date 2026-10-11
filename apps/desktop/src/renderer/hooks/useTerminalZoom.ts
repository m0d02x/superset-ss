import { useCallback } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { DEFAULT_TERMINAL_FONT_SIZE } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/config";
import {
	nextTerminalFontSize,
	type TerminalZoomAction,
} from "shared/terminal-zoom";

/**
 * View-menu zoom for terminals only: steps the terminal font size setting.
 * Every terminal (local and server) follows that setting live, so the rest
 * of the app stays at its normal size.
 */
export function useTerminalZoom(): (action: TerminalZoomAction) => void {
	const utils = electronTrpc.useUtils();
	const setFontSettings = electronTrpc.settings.setFontSettings.useMutation({
		onSettled: () => utils.settings.getFontSettings.invalidate(),
	});
	const mutate = setFontSettings.mutate;

	return useCallback(
		(action: TerminalZoomAction) => {
			const current =
				utils.settings.getFontSettings.getData()?.terminalFontSize ??
				DEFAULT_TERMINAL_FONT_SIZE;
			const terminalFontSize = nextTerminalFontSize(action, current);
			if (terminalFontSize === current) return;
			// Optimistic: terminals re-read this query, so they resize at once.
			utils.settings.getFontSettings.setData(undefined, (old) =>
				old ? { ...old, terminalFontSize } : old,
			);
			mutate({ terminalFontSize });
		},
		[mutate, utils],
	);
}
