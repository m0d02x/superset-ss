import { describe, expect, test } from "bun:test";
import { getPastedImageFile, quoteRemotePath } from "./setupRemoteImagePaste";

function clipboard(
	text: string,
	items: Array<{ kind: string; type: string; file?: File }>,
): DataTransfer {
	return {
		getData: (format: string) => (format === "text/plain" ? text : ""),
		items: items.map((item) => ({
			...item,
			getAsFile: () => item.file ?? null,
		})),
	} as unknown as DataTransfer;
}

const png = new File([new Uint8Array([137, 80, 78, 71])], "image.png", {
	type: "image/png",
});

describe("getPastedImageFile", () => {
	test("returns the image file when the paste has no text", () => {
		expect(
			getPastedImageFile(
				clipboard("", [{ kind: "file", type: "image/png", file: png }]),
			),
		).toBe(png);
	});

	test("text wins over an image so normal paste is untouched", () => {
		expect(
			getPastedImageFile(
				clipboard("hello", [
					{ kind: "string", type: "text/plain" },
					{ kind: "file", type: "image/png", file: png },
				]),
			),
		).toBeNull();
	});

	test("non-image files are not uploaded", () => {
		const pdf = new File(["%PDF"], "doc.pdf", { type: "application/pdf" });
		expect(
			getPastedImageFile(
				clipboard("", [{ kind: "file", type: "application/pdf", file: pdf }]),
			),
		).toBeNull();
	});

	test("missing clipboard data is not an image paste", () => {
		expect(getPastedImageFile(null)).toBeNull();
	});
});

describe("quoteRemotePath", () => {
	test("leaves shell-safe paths bare", () => {
		expect(
			quoteRemotePath("/home/ubuntu/.hyperset/clipboard/paste-1.png"),
		).toBe("/home/ubuntu/.hyperset/clipboard/paste-1.png");
	});

	test("single-quotes paths with spaces", () => {
		expect(quoteRemotePath("/home/my user/a.png")).toBe(
			"'/home/my user/a.png'",
		);
	});

	test("escapes embedded single quotes", () => {
		expect(quoteRemotePath("/home/o'neil/a.png")).toBe(
			"'/home/o'\\''neil/a.png'",
		);
	});
});
