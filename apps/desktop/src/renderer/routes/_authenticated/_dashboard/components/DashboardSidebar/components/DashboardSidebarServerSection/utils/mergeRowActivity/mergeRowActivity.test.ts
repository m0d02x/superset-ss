import { describe, expect, it } from "bun:test";
import { mergeRowActivity } from "./mergeRowActivity";

describe("mergeRowActivity", () => {
	it("surfaces the most urgent status across spaces", () => {
		expect(
			mergeRowActivity([
				{ status: "review" },
				{ status: "permission" },
				{ status: null },
			])?.status,
		).toBe("permission");
	});

	it("adds up live terminals and names a working program over an idle one", () => {
		const merged = mergeRowActivity([
			{
				remote: {
					terminalCount: 2,
					command: "omp",
					state: "running",
					title: "Old task",
				},
			},
			{
				remote: {
					terminalCount: 1,
					command: "omp",
					state: "working",
					title: "Fix login bug",
				},
			},
			{
				remote: {
					terminalCount: 1,
					command: null,
					state: "shell",
					title: null,
				},
			},
		]);
		expect(merged?.remote).toEqual({
			terminalCount: 4,
			command: "omp",
			state: "working",
			title: "Fix login bug",
		});
	});

	it("is undefined for a group with no spaces", () => {
		expect(mergeRowActivity([])).toBeUndefined();
	});
});
