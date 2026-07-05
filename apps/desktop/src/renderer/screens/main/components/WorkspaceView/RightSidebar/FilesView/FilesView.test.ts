import { describe, expect, it } from "bun:test";
import { getParentPath } from "./FilesView";

describe("getParentPath", () => {
	it("keeps unix root stable", () => {
		expect(getParentPath("/")).toBe("/");
		expect(getParentPath("/home/user/project")).toBe("/home/user");
	});

	it("keeps windows drive roots stable", () => {
		expect(getParentPath("C:\\Users\\me\\project")).toBe("C:\\Users\\me");
		expect(getParentPath("C:\\Users")).toBe("C:\\");
	});
});
