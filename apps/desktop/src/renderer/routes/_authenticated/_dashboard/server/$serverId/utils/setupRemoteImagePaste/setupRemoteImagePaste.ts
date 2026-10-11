import { toast } from "@superset/ui/sonner";
import type { Terminal as XTerm } from "@xterm/xterm";

const SHELL_SAFE_PATH = /^[\w@%+=:,./-]+$/;

export interface PastedImage {
	/** Base64-encoded file bytes */
	data: string;
	mimeType: string;
}

/** Quote a remote path for the shell only when it contains unsafe characters. */
export function quoteRemotePath(path: string): string {
	return SHELL_SAFE_PATH.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;
}

/**
 * The image file carried by a paste that has no plain text (e.g. a screenshot
 * or a Finder-copied image), or null. Must be called synchronously inside the
 * paste event — clipboard items are inaccessible afterwards.
 */
export function getPastedImageFile(data: DataTransfer | null): File | null {
	if (!data || data.getData("text/plain")) return null;
	for (const item of Array.from(data.items)) {
		if (item.kind === "file" && item.type.startsWith("image/")) {
			return item.getAsFile();
		}
	}
	return null;
}

function readAsBase64(file: File): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const reader = new FileReader();
	reader.onload = () => {
		const url = String(reader.result);
		resolve(url.slice(url.indexOf(",") + 1));
	};
	reader.onerror = () =>
		reject(reader.error ?? new Error("Could not read pasted image"));
	reader.readAsDataURL(file);
	return promise;
}
/**
 * xterm only pastes text. When a paste carries an image, upload its bytes to
 * the server via `uploadImage` and paste the resulting remote path.
 * Returns a cleanup function that removes the listener.
 */
export function setupRemoteImagePaste(
	terminal: XTerm,
	uploadImage: (image: PastedImage) => Promise<{ remotePath: string }>,
): () => void {
	const textarea = terminal.textarea;
	if (!textarea) return () => {};

	let disposed = false;
	const handlePaste = (event: ClipboardEvent) => {
		const file = getPastedImageFile(event.clipboardData);
		if (!file) return;

		event.preventDefault();
		event.stopImmediatePropagation();
		const toastId = toast.loading("Uploading image to server…");
		readAsBase64(file)
			.then((data) => uploadImage({ data, mimeType: file.type }))
			.then(({ remotePath }) => {
				toast.dismiss(toastId);
				if (!disposed) terminal.paste(quoteRemotePath(remotePath));
			})
			.catch((error: unknown) => {
				toast.error(
					`Image paste failed: ${error instanceof Error ? error.message : String(error)}`,
					{ id: toastId },
				);
			});
	};

	textarea.addEventListener("paste", handlePaste, { capture: true });
	return () => {
		disposed = true;
		textarea.removeEventListener("paste", handlePaste, { capture: true });
	};
}
