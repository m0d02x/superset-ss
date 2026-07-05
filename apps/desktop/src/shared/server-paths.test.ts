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
});
