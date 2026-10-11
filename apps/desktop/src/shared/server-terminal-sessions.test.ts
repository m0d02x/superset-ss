import { describe, expect, it } from "bun:test";
import { buildRestoredServerTerminals } from "./server-terminal-sessions";

describe("buildRestoredServerTerminals", () => {
	it("restores persisted external tmux session names", () => {
		expect(
			buildRestoredServerTerminals({
				spaceId: "space-1",
				persisted: [
					{
						terminalId: "term-9",
						label: "prod shell",
						tmuxSessionName: "prod",
						sortOrder: 0,
						isSelected: true,
					},
				],
				discovered: [],
			}),
		).toEqual({
			terminals: [{ id: "term-9", label: "prod shell" }],
			selectedTerminalId: "term-9",
			tmuxOverrides: [["space-1:term-9", "prod"]],
		});
	});

	it("falls back to discovered Hyperset sessions when nothing is persisted", () => {
		expect(
			buildRestoredServerTerminals({
				spaceId: "space-1",
				persisted: [],
				discovered: [
					{ terminalId: "term-2", label: "api" },
					{ terminalId: "term-1", label: null },
				],
			}),
		).toEqual({
			terminals: [
				{ id: "term-2", label: "api" },
				{ id: "term-1", label: "Terminal 1" },
			],
			selectedTerminalId: "term-2",
			tmuxOverrides: [],
		});
	});
});
