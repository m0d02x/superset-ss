/**
 * Human-facing names and paths for server/local spaces.
 *
 * Spaces created before folder-based naming carry generated labels like
 * "Space 3"; those are treated as unnamed so the folder name shows instead.
 */

const GENERATED_LABEL = /^Space \d+$/;

/** Fallback label for a space with neither a custom name nor a folder. */
export const UNTITLED_SPACE_LABEL = "Untitled";

/** True when the user typed this label (not a default like "Space 3"). */
export function isCustomSpaceLabel(label: string | null | undefined): boolean {
	const trimmed = label?.trim();
	return Boolean(trimmed) && !GENERATED_LABEL.test(trimmed ?? "");
}

/** Last path segment: `~/dev/claix-dev` → `claix-dev`. */
export function directoryName(
	directory: string | null | undefined,
): string | null {
	const segments = directory?.trim().replace(/\/+$/, "").split("/");
	const last = segments?.at(-1);
	return last && last !== "~" ? last : null;
}

export interface SpaceLabelInput {
	id: string;
	label: string | null | undefined;
	/** Resolved directory (absolute or `~/…`); used for folder-based names. */
	directory?: string | null;
}

/**
 * Display label per space id. Custom labels are kept verbatim. Otherwise the
 * folder name is used, and duplicates get a numeric suffix in list order
 * (`claix-dev`, `claix-dev 2`). Spaces without a folder become "Untitled".
 */
export function getSpaceDisplayLabels(
	spaces: readonly SpaceLabelInput[],
): Map<string, string> {
	const labels = new Map<string, string>();
	const seen = new Map<string, number>();
	for (const space of spaces) {
		const base = isCustomSpaceLabel(space.label)
			? (space.label?.trim() ?? UNTITLED_SPACE_LABEL)
			: (directoryName(space.directory) ?? UNTITLED_SPACE_LABEL);
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		labels.set(space.id, count === 1 ? base : `${base} ${count}`);
	}
	return labels;
}

/**
 * Compact path for the sidebar: home-relative when under `homeDirectory`
 * (`/home/ubuntu/dev/x` → `~/dev/x`), otherwise the last two segments with an
 * ellipsis (`/srv/apps/x` → `…/apps/x`). Short paths are shown in full.
 */
export function formatSpaceDirectory(
	directory: string,
	homeDirectory: string | null | undefined,
): string {
	const path = directory.trim().replace(/\/+$/, "") || "/";
	const home = homeDirectory?.trim().replace(/\/+$/, "");
	let display = path;
	if (home && (path === home || path.startsWith(`${home}/`))) {
		display = `~${path.slice(home.length)}`;
	}

	const segments = display.split("/").filter(Boolean);
	const isHomeRelative = display.startsWith("~");
	const maxSegments = isHomeRelative ? 3 : 2;
	if (segments.length <= maxSegments) {
		return isHomeRelative ? display : `/${segments.join("/")}`;
	}
	return `…/${segments.slice(-2).join("/")}`;
}

/** Default home directory for an SSH user (mirrors the server dialog). */
export function getDefaultHomeDirectory(username: string): string {
	const trimmed = username.trim();
	if (!trimmed || trimmed === "root") return "/root";
	return `/home/${trimmed}`;
}
