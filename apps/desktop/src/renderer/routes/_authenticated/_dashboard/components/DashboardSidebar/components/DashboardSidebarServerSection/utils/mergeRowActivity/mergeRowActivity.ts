import type { SpaceActivitySummary } from "shared/server-activity";
import {
	type ActivePaneStatus,
	getHighestPriorityStatus,
} from "shared/tabs-types";
import type { SpaceRowActivity } from "../../SpaceActivityBadge";

/**
 * Combine several space rows into one group-level summary for a collapsed
 * header: the most urgent status wins, terminal counts add up, and the program
 * shown is the busiest one.
 */
export function mergeRowActivity(
	rows: Iterable<SpaceRowActivity>,
): SpaceRowActivity | undefined {
	const statuses: Array<ActivePaneStatus | null | undefined> = [];
	let terminalCount = 0;
	let top: SpaceActivitySummary | undefined;
	let hasAny = false;
	for (const row of rows) {
		hasAny = true;
		statuses.push(row.status);
		const remote = row.remote;
		if (!remote) continue;
		terminalCount += remote.terminalCount;
		if (
			remote.command &&
			(!top?.command || (remote.state === "working" && top.state !== "working"))
		) {
			top = remote;
		}
	}
	if (!hasAny) return undefined;
	const status = getHighestPriorityStatus(statuses.map((s) => s ?? undefined));
	return {
		status,
		remote: {
			terminalCount,
			command: top?.command ?? null,
			state: top?.state ?? null,
			title: top?.title ?? null,
		},
	};
}
