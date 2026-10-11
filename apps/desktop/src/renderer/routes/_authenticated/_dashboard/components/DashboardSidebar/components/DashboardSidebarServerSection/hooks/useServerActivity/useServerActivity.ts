import { useEffect, useMemo, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	type SpaceActivitySummary,
	summarizeSpaceActivity,
} from "shared/server-activity";

/** One SSH exec per connected server; tmux answers in a few ms. */
const ACTIVITY_POLL_MS = 3000;

export interface ServerSpaceActivity {
	summary: SpaceActivitySummary;
	/** A program finished producing output while this space was not open. */
	isDone: boolean;
}

/**
 * Polls tmux activity for a connected server and tracks "done": a space whose
 * program went from producing output to quiet while the user was elsewhere.
 * Viewing the space (`activeSpaceId`) acknowledges it.
 */
export function useServerActivity(
	serverId: string,
	isConnected: boolean,
	activeSpaceId: string | null,
): Map<string, ServerSpaceActivity> {
	const { data: activity } = electronTrpc.servers.getActivity.useQuery(
		{ serverId },
		{
			enabled: isConnected,
			refetchInterval: isConnected ? ACTIVITY_POLL_MS : false,
			refetchOnWindowFocus: false,
		},
	);

	const summaries = useMemo(() => {
		const result = new Map<string, SpaceActivitySummary>();
		for (const space of activity ?? []) {
			result.set(space.spaceId, summarizeSpaceActivity(space));
		}
		return result;
	}, [activity]);

	const [doneSpaceIds, setDoneSpaceIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const wasWorkingRef = useRef(new Set<string>());

	useEffect(() => {
		const working = new Set<string>();
		const finished: string[] = [];
		for (const [spaceId, summary] of summaries) {
			if (summary.state === "working") {
				working.add(spaceId);
			} else if (
				wasWorkingRef.current.has(spaceId) &&
				spaceId !== activeSpaceId
			) {
				finished.push(spaceId);
			}
		}
		// A space that vanished mid-work (terminal closed) is not "done".
		wasWorkingRef.current = working;
		if (finished.length === 0) return;
		setDoneSpaceIds((current) => new Set([...current, ...finished]));
	}, [summaries, activeSpaceId]);

	useEffect(() => {
		if (!activeSpaceId) return;
		setDoneSpaceIds((current) => {
			if (!current.has(activeSpaceId)) return current;
			const next = new Set(current);
			next.delete(activeSpaceId);
			return next;
		});
	}, [activeSpaceId]);

	return useMemo(() => {
		const result = new Map<string, ServerSpaceActivity>();
		for (const [spaceId, summary] of summaries) {
			result.set(spaceId, {
				summary,
				isDone: doneSpaceIds.has(spaceId) && summary.state !== "working",
			});
		}
		return result;
	}, [summaries, doneSpaceIds]);
}
