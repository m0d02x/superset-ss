import { describe, expect, it } from "bun:test";
import type { SerializeAddon } from "@xterm/addon-serialize";
import {
	clearRemoteTerminalSnapshot,
	getRemoteTerminalSnapshot,
	saveRemoteTerminalSnapshot,
} from "./view-state";

describe("remote terminal view state", () => {
	it("stores and clears remote terminal snapshots", () => {
		const key = "server-a:term-1";
		const serializer = {
			serialize: () => "ubuntu@mcl:~/dev$ ls\r\napps\r\n",
		} as unknown as SerializeAddon;

		saveRemoteTerminalSnapshot({ key, serializer });
		expect(getRemoteTerminalSnapshot(key)).toContain("ubuntu@mcl");

		clearRemoteTerminalSnapshot(key);
		expect(getRemoteTerminalSnapshot(key)).toBeNull();
	});

	it("returns null for missing snapshots", () => {
		expect(getRemoteTerminalSnapshot("missing")).toBeNull();
	});
});
