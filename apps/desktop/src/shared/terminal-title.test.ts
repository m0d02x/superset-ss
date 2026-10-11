import { describe, expect, it } from "bun:test";
import { normalizeTerminalTitle } from "./terminal-title";

describe("normalizeTerminalTitle", () => {
	it("strips omp's π marker and working spinner to the session name", () => {
		expect(normalizeTerminalTitle("π ⠋ Fix login bug")).toEqual({
			kind: "agent",
			label: "Fix login bug",
		});
		expect(normalizeTerminalTitle("π Fix login bug")).toEqual({
			kind: "agent",
			label: "Fix login bug",
		});
	});

	it("strips omp's idle '>' and attention '!' state glyphs (real titles)", () => {
		expect(normalizeTerminalTitle("π > tmp").label).toBe("tmp");
		expect(normalizeTerminalTitle("π ! Fix login bug").label).toBe(
			"Fix login bug",
		);
		expect(normalizeTerminalTitle("π >").kind).toBe("empty");
	});

	it("labels a session the same in every omp state", () => {
		const states = ["⠋", ">", "!", ":"].map(
			(state) => normalizeTerminalTitle(`π ${state} Plan tests`).label,
		);
		expect(new Set(states)).toEqual(new Set(["Plan tests"]));
	});

	it("gives every spinner frame the same label so the tab does not flicker", () => {
		const frames = ["⠋", "⠙", "⠹", "⠸", "⠼"].map(
			(frame) => normalizeTerminalTitle(`π ${frame} Plan tests`).label,
		);
		expect(new Set(frames)).toEqual(new Set(["Plan tests"]));
	});

	it("handles omp's disabled-animation form 'π: name'", () => {
		expect(normalizeTerminalTitle("π: claix-dev").label).toBe("claix-dev");
	});

	it("strips Claude Code's ✳ prefix", () => {
		expect(normalizeTerminalTitle("✳ Refactor auth")).toEqual({
			kind: "agent",
			label: "Refactor auth",
		});
	});

	it("treats a bare marker or spinner as empty", () => {
		expect(normalizeTerminalTitle("π").kind).toBe("empty");
		expect(normalizeTerminalTitle("π ⠋").kind).toBe("empty");
		expect(normalizeTerminalTitle("   ").kind).toBe("empty");
	});

	it("classifies shell prompt titles as shell", () => {
		expect(normalizeTerminalTitle("dev/claix-dev")).toEqual({
			kind: "shell",
			label: "dev/claix-dev",
		});
		expect(normalizeTerminalTitle("ubuntu@mcl: ~/dev").kind).toBe("shell");
	});

	it("keeps names that merely contain π or ✳ mid-string", () => {
		expect(normalizeTerminalTitle("compute π digits")).toEqual({
			kind: "shell",
			label: "compute π digits",
		});
	});
});
