/**
 * Remote directory listing for the new-space folder picker.
 *
 * One POSIX shell command prints the resolved absolute path of the requested
 * folder, then the absolute paths of its subfolders (hidden ones included,
 * symlink targets resolved, sorted case-insensitively):
 *
 *   /home/ubuntu/code
 *   /home/ubuntu/code/apps
 *   /home/ubuntu/code/packages
 *
 * If the folder cannot be opened (missing, no permission), nothing is printed
 * and the parser reports an error instead of an empty folder.
 */

const LIST_ERROR = "Can't open this folder on the server.";
const SAFE_PATH = /^[a-zA-Z0-9._~/-]+$/;

/** Quote only when needed so `~` and plain paths stay readable in the command. */
function shellQuotePath(path: string): string {
	return SAFE_PATH.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

export function buildListDirectoriesCommand(rawPath: string): string {
	const path = shellQuotePath(rawPath.trim() || "~");
	return `p=$(cd ${path} 2>/dev/null && pwd -P) && echo "$p" && find -L "$p" -maxdepth 1 -mindepth 1 -type d -print 2>/dev/null | sort -f`;
}

export interface RemoteDirectoryListing {
	/** Absolute path that was listed, as resolved on the server. */
	path: string | null;
	/** Subfolder names of `path`, sorted; `~` already resolved. */
	entries: string[];
	/** Human-readable failure reason; null on success. */
	error: string | null;
}

export function parseListDirectoriesOutput(exec: {
	stdout: string;
}): RemoteDirectoryListing {
	const lines = exec.stdout.split("\n");
	const first = lines.shift()?.trim() ?? "";
	if (!first) {
		return { path: null, entries: [], error: LIST_ERROR };
	}

	const entries = lines
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((absolute) => absolute.slice(first.length).replace(/^\/+/, ""))
		.filter((relative) => relative.length > 0);

	return { path: first, entries, error: null };
}

/** `/base/dir/` + `entry` → `/base/dir/entry`. */
export function joinRemotePath(base: string, entry: string): string {
	return `${base.replace(/\/+$/, "")}/${entry.replace(/^\/+/, "")}`;
}
