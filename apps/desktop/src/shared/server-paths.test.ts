import { describe, expect, it } from "bun:test";
import { resolveServerSpaceDirectory } from "./server-paths";

describe("resolveServerSpaceDirectory", () => {
	it("resolves relative-looking slash paths from the server base directory", () => {
		expect(resolveServerSpaceDirectory("/dev/claix-dev", "/home/ubuntu/")).toBe(
			"/home/ubuntu/dev/claix-dev",
		);
	});

	it("keeps home paths absolute", () => {
		expect(resolveServerSpaceDirectory("~/work", "/home/ubuntu")).toBe(
			"~/work",
		);
	});

	it("does not prefix a path that is already under the base directory", () => {
		expect(
			resolveServerSpaceDirectory("/home/ubuntu/dev/claix-dev", "/home/ubuntu"),
		).toBe("/home/ubuntu/dev/claix-dev");
		expect(resolveServerSpaceDirectory("/home/ubuntu", "/home/ubuntu/")).toBe(
			"/home/ubuntu",
		);
	});

	it("still treats a sibling sharing the base prefix as relative", () => {
		expect(resolveServerSpaceDirectory("/home/ubuntu2", "/home/ubuntu")).toBe(
			"/home/ubuntu/home/ubuntu2",
		);
	});
});
