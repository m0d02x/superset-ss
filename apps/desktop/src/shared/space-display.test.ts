import { describe, expect, it } from "bun:test";
import {
	formatSpaceDirectory,
	getSpaceDisplayLabels,
	isCustomSpaceLabel,
} from "./space-display";

describe("isCustomSpaceLabel", () => {
	it("treats generated 'Space N' labels and blanks as unnamed", () => {
		expect(isCustomSpaceLabel("Space 3")).toBe(false);
		expect(isCustomSpaceLabel("  ")).toBe(false);
		expect(isCustomSpaceLabel(null)).toBe(false);
	});

	it("keeps user-chosen names, including ones that start with 'Space'", () => {
		expect(isCustomSpaceLabel("Claix")).toBe(true);
		expect(isCustomSpaceLabel("Space station")).toBe(true);
	});
});

describe("getSpaceDisplayLabels", () => {
	it("names unnamed spaces after their folder and suffixes duplicates in order", () => {
		const labels = getSpaceDisplayLabels([
			{ id: "a", label: "Claix", directory: "/home/ubuntu/dev/claix-dev" },
			{ id: "b", label: "Space 3", directory: "/home/ubuntu/dev/claix-dev" },
			{ id: "c", label: "Space 3", directory: "~/dev/claix-dev/" },
			{ id: "d", label: "Space 4", directory: null },
			{ id: "e", label: "Space 5", directory: undefined },
		]);
		expect(Object.fromEntries(labels)).toEqual({
			a: "Claix",
			b: "claix-dev",
			c: "claix-dev 2",
			d: "Untitled",
			e: "Untitled 2",
		});
	});

	it("disambiguates a custom label that collides with a folder name", () => {
		const labels = getSpaceDisplayLabels([
			{ id: "a", label: "api", directory: "/srv/other" },
			{ id: "b", label: null, directory: "/srv/api" },
		]);
		expect(labels.get("b")).toBe("api 2");
	});

	it("does not use a bare home directory as a folder name", () => {
		const labels = getSpaceDisplayLabels([
			{ id: "a", label: null, directory: "~" },
		]);
		expect(labels.get("a")).toBe("Untitled");
	});
});

describe("formatSpaceDirectory", () => {
	it("shows paths under the home directory as ~-relative", () => {
		expect(
			formatSpaceDirectory("/home/ubuntu/dev/claix-dev", "/home/ubuntu"),
		).toBe("~/dev/claix-dev");
		expect(formatSpaceDirectory("/home/ubuntu", "/home/ubuntu/")).toBe("~");
	});

	it("does not treat a sibling with a shared prefix as inside home", () => {
		expect(formatSpaceDirectory("/home/ubuntu2", "/home/ubuntu")).toBe(
			"/home/ubuntu2",
		);
	});

	it("keeps already ~-relative paths", () => {
		expect(formatSpaceDirectory("~/.config/opencode", "/home/ubuntu")).toBe(
			"~/.config/opencode",
		);
	});

	it("elides deep paths to the last two segments", () => {
		expect(formatSpaceDirectory("/srv/www/apps/claix", null)).toBe(
			"…/apps/claix",
		);
		expect(formatSpaceDirectory("/home/ubuntu/a/b/c/d", "/home/ubuntu")).toBe(
			"…/c/d",
		);
	});

	it("shows short absolute paths in full", () => {
		expect(formatSpaceDirectory("/srv/app/", null)).toBe("/srv/app");
		expect(formatSpaceDirectory("/", null)).toBe("/");
	});
});
