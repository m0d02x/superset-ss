import { describe, expect, it } from "bun:test";
import {
	MAX_TERMINAL_FONT_SIZE,
	MIN_TERMINAL_FONT_SIZE,
	nextTerminalFontSize,
} from "./terminal-zoom";

describe("nextTerminalFontSize", () => {
	it("steps by one point", () => {
		expect(nextTerminalFontSize("in", 14)).toBe(15);
		expect(nextTerminalFontSize("out", 14)).toBe(13);
	});

	it("clamps at the setting's allowed range", () => {
		expect(nextTerminalFontSize("in", MAX_TERMINAL_FONT_SIZE)).toBe(
			MAX_TERMINAL_FONT_SIZE,
		);
		expect(nextTerminalFontSize("out", MIN_TERMINAL_FONT_SIZE)).toBe(
			MIN_TERMINAL_FONT_SIZE,
		);
	});

	it("resets to the default by clearing the override", () => {
		expect(nextTerminalFontSize("reset", 20)).toBeNull();
	});
});
