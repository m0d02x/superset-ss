import { describe, expect, it } from "bun:test";
import {
	buildListDirectoriesCommand,
	joinRemotePath,
	parseListDirectoriesOutput,
} from "./server-directories";

describe("buildListDirectoriesCommand", () => {
	it("quotes paths that are not shell-safe", () => {
		expect(buildListDirectoriesCommand("/tmp/my dir")).toContain(
			"cd '/tmp/my dir'",
		);
	});

	it("passes safe paths through unquoted so `~` expands", () => {
		expect(buildListDirectoriesCommand("~/code")).toContain("cd ~/code");
	});

	it("falls back to home for an empty path", () => {
		expect(buildListDirectoriesCommand("")).toContain("cd ~");
	});
});

describe("parseListDirectoriesOutput", () => {
	it("returns the resolved path and relative entry names", () => {
		const listing = parseListDirectoriesOutput({
			stdout: "/home/u/code\n/home/u/code/apps\n/home/u/code/.hidden\n",
		});
		expect(listing).toEqual({
			path: "/home/u/code",
			entries: ["apps", ".hidden"],
			error: null,
		});
	});

	it("handles the filesystem root", () => {
		const listing = parseListDirectoriesOutput({ stdout: "/\n/bin\n/etc\n" });
		expect(listing.path).toBe("/");
		expect(listing.entries).toEqual(["bin", "etc"]);
	});

	it("reports an error when nothing was printed", () => {
		const listing = parseListDirectoriesOutput({ stdout: "" });
		expect(listing.path).toBeNull();
		expect(listing.entries).toEqual([]);
		expect(listing.error).not.toBeNull();
	});
});

describe("joinRemotePath", () => {
	it("joins and normalises slashes", () => {
		expect(joinRemotePath("/home/u/code/", "apps")).toBe("/home/u/code/apps");
		expect(joinRemotePath("/", "bin")).toBe("/bin");
	});
});
