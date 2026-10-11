import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Terminal as XTerm } from "@xterm/xterm";
import {
	setupCopyOnSelect,
	systemClipboardProvider,
	trimSelectionLines,
} from "./clipboard";

function createXtermStub() {
	let selection = "";
	let listener: (() => void) | null = null;
	const dispose = mock(() => {
		listener = null;
	});
	const xterm = {
		onSelectionChange: (cb: () => void) => {
			listener = cb;
			return { dispose };
		},
		hasSelection: () => selection.length > 0,
		getSelection: () => selection,
	} as unknown as XTerm;
	return {
		xterm,
		dispose,
		select(text: string) {
			selection = text;
			listener?.();
		},
	};
}

const originalNavigator = Object.getOwnPropertyDescriptor(
	globalThis,
	"navigator",
);

afterEach(() => {
	if (originalNavigator) {
		Object.defineProperty(globalThis, "navigator", originalNavigator);
	} else {
		Reflect.deleteProperty(globalThis, "navigator");
	}
});

function stubClipboard(clipboard: Partial<Clipboard>) {
	Object.defineProperty(globalThis, "navigator", {
		value: { clipboard },
		configurable: true,
		writable: true,
	});
}

describe("systemClipboardProvider", () => {
	it("writes tmux's empty-selection OSC 52 to the system clipboard", async () => {
		const writeText = mock(async (_text: string) => {});
		stubClipboard({ writeText });

		await systemClipboardProvider.writeText("", "from tmux");
		await systemClipboardProvider.writeText("p", "primary");

		expect(writeText.mock.calls.map(([text]) => text)).toEqual([
			"from tmux",
			"primary",
		]);
	});

	it("refuses to report the clipboard for non-system selections", async () => {
		const readText = mock(async () => "secret");
		stubClipboard({ readText });

		expect(await systemClipboardProvider.readText("")).toBe("");
		expect(readText).not.toHaveBeenCalled();
		expect(await systemClipboardProvider.readText("c")).toBe("secret");
	});
});

describe("setupCopyOnSelect", () => {
	it("copies the trimmed selection when text is selected", () => {
		const { xterm, select } = createXtermStub();
		const write = mock((_text: string) => {});
		setupCopyOnSelect(xterm, write);

		select("https://example.com/a   \nsecond line  ");

		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith("https://example.com/a\nsecond line");
	});

	it("does not copy when the selection is cleared", () => {
		const { xterm, select } = createXtermStub();
		const write = mock((_text: string) => {});
		setupCopyOnSelect(xterm, write);

		select("hello");
		select("");

		expect(write).toHaveBeenCalledTimes(1);
	});

	it("skips unchanged selections but copies a new one", () => {
		const { xterm, select } = createXtermStub();
		const write = mock((_text: string) => {});
		setupCopyOnSelect(xterm, write);

		select("one");
		select("one");
		select("one two");

		expect(write.mock.calls.map(([text]) => text)).toEqual(["one", "one two"]);
	});

	it("retries the same text after a failed clipboard write", async () => {
		const { xterm, select } = createXtermStub();
		let fail = true;
		const write = mock(async (_text: string) => {
			if (fail) throw new Error("not focused");
		});
		setupCopyOnSelect(xterm, write);

		select("retry me");
		await Promise.resolve();
		await Promise.resolve();
		fail = false;
		select("retry me");

		expect(write).toHaveBeenCalledTimes(2);
	});

	it("stops copying after cleanup", () => {
		const { xterm, select, dispose } = createXtermStub();
		const write = mock((_text: string) => {});
		const cleanup = setupCopyOnSelect(xterm, write);

		cleanup();
		select("late");

		expect(dispose).toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});
});

describe("trimSelectionLines", () => {
	it("trims each line but keeps blank lines", () => {
		expect(trimSelectionLines("a  \n\n  b  ")).toBe("a\n\n  b");
	});
});
