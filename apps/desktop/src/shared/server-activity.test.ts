import { describe, expect, it } from "bun:test";
import {
	parseServerActivity,
	summarizeSpaceActivity,
	WORKING_WINDOW_SECONDS,
} from "./server-activity";

const SPACE = "75fab34c-9f7a-493b-adbb-ce0f32be3568";
const NOW = 1_791_712_743;

function listing(
	panes: Array<
		[session: string, command: string, activity: number, title?: string]
	>,
): string {
	return [
		...panes.map(([s, c, a, t = ""]) => `${s}\t${c}\t${a}\t${t}`),
		`now\t${NOW}`,
		"",
	].join("\n");
}

describe("parseServerActivity", () => {
	it("marks an agent that produced output recently as working", () => {
		const [space] = parseServerActivity(
			listing([[`ss-${SPACE}-term-1`, "omp", NOW - 1]]),
		);
		expect(space?.spaceId).toBe(SPACE);
		expect(space?.terminals).toEqual([
			{
				terminalId: "term-1",
				command: "omp",
				state: "working",
				idleSeconds: 1,
				title: null,
			},
		]);
	});

	it("takes the agent session title from the pane, without spinner decoration", () => {
		const [space] = parseServerActivity(
			listing([[`ss-${SPACE}-term-1`, "omp", NOW, "π ⠋ Fix login bug"]]),
		);
		expect(space?.terminals[0]?.title).toBe("Fix login bug");
	});

	it("ignores shell prompt titles and keeps titles that contain tabs", () => {
		const spaces = parseServerActivity(
			listing([
				[`ss-${SPACE}-term-1`, "bash", NOW, "dev/claix-dev"],
				[`ss-${SPACE}-term-2`, "omp", NOW, "π a\tb"],
			]),
		);
		expect(spaces[0]?.terminals.map((t) => t.title)).toEqual([null, "a\tb"]);
	});

	it("marks a quiet agent as running, not working (idle omp keeps no clock ticking)", () => {
		const [space] = parseServerActivity(
			listing([[`ss-${SPACE}-term-1`, "omp", NOW - 34]]),
		);
		expect(space?.terminals[0]?.state).toBe("running");
	});

	it("treats the working window boundary as inclusive", () => {
		const [space] = parseServerActivity(
			listing([[`ss-${SPACE}-term-1`, "node", NOW - WORKING_WINDOW_SECONDS]]),
		);
		expect(space?.terminals[0]?.state).toBe("working");
	});

	it("reports a bare shell as shell even with fresh output", () => {
		const [space] = parseServerActivity(
			listing([[`ss-${SPACE}-term-2`, "bash", NOW]]),
		);
		expect(space?.terminals[0]?.state).toBe("shell");
	});

	it("groups terminals by space and keeps space ids containing dashes intact", () => {
		const other = "a66b9288-0101-4be2-82c6-9b93e3cc24de";
		const spaces = parseServerActivity(
			listing([
				[`ss-${SPACE}-term-1`, "omp", NOW],
				[`ss-${SPACE}-term-2`, "bash", NOW],
				[`ss-${other}-term-1`, "node", NOW - 100],
			]),
		);
		expect(spaces.map((s) => [s.spaceId, s.terminals.length])).toEqual([
			[SPACE, 2],
			[other, 1],
		]);
	});

	it("ignores sessions that are not Hyperset space terminals", () => {
		expect(
			parseServerActivity(
				listing([
					["main", "vim", NOW],
					["ss-legacy", "bash", NOW],
				]),
			),
		).toEqual([]);
	});

	it("keeps the most active pane when one session has several", () => {
		const [space] = parseServerActivity(
			listing([
				[`ss-${SPACE}-term-1`, "bash", NOW],
				[`ss-${SPACE}-term-1`, "omp", NOW],
			]),
		);
		expect(space?.terminals).toHaveLength(1);
		expect(space?.terminals[0]).toMatchObject({
			command: "omp",
			state: "working",
		});
	});

	it("returns nothing without the server clock line (no tmux server / failed exec)", () => {
		expect(parseServerActivity("")).toEqual([]);
		expect(parseServerActivity(`ss-${SPACE}-term-1\tomp\t${NOW}\n`)).toEqual(
			[],
		);
	});
});

describe("summarizeSpaceActivity", () => {
	it("names the most active non-shell program and its session title", () => {
		const [space] = parseServerActivity(
			listing([
				[`ss-${SPACE}-term-1`, "bash", NOW],
				[`ss-${SPACE}-term-2`, "omp", NOW - 60, "π Old task"],
				[`ss-${SPACE}-term-3`, "omp", NOW - 1, "π ⠙ Fix login bug"],
			]),
		);
		expect(summarizeSpaceActivity(space)).toEqual({
			terminalCount: 3,
			command: "omp",
			state: "working",
			title: "Fix login bug",
		});
	});

	it("names no program when only shells are open", () => {
		const [space] = parseServerActivity(
			listing([[`ss-${SPACE}-term-1`, "zsh", NOW]]),
		);
		expect(summarizeSpaceActivity(space)).toEqual({
			terminalCount: 1,
			command: null,
			state: "shell",
			title: null,
		});
	});

	it("is empty for a space with no live terminals", () => {
		expect(summarizeSpaceActivity(undefined)).toEqual({
			terminalCount: 0,
			command: null,
			state: null,
			title: null,
		});
	});
});
