import { describe, expect, it } from "bun:test";
import { activateTreeEntry } from "./folder-activation";

describe("activateTreeEntry", () => {
	it("toggles a folder instead of opening it in the editor", () => {
		let expanded = false;
		let editorOpenCount = 0;

		activateTreeEntry({
			isDirectory: true,
			isExpanded: false,
			item: {
				collapse: () => {
					expanded = false;
				},
				expand: () => {
					expanded = true;
				},
			},
			onOpenInEditor: () => {
				editorOpenCount += 1;
			},
		});

		expect(expanded).toBeTrue();
		expect(editorOpenCount).toBe(0);
	});
});
