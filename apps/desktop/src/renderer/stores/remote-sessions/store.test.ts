import { afterEach, describe, expect, it, mock } from "bun:test";

const openShellMutate = mock(async ({ serverId }: { serverId: string }) => ({
	sessionId: `${serverId}-session-${Math.random().toString(36).slice(2, 8)}`,
}));
const closeShellMutate = mock(
	async (_input: { sessionId: string }) => undefined,
);

mock.module("renderer/lib/trpc-client", () => ({
	electronTrpcClient: {
		servers: {
			openShell: { mutate: openShellMutate },
			closeShell: { mutate: closeShellMutate },
		},
	},
}));

const { buildRemoteSessionKey, useRemoteSessionsStore } = await import(
	"./store"
);

describe("remote session store", () => {
	afterEach(() => {
		useRemoteSessionsStore.getState().clearAllSessions();
		openShellMutate.mockClear();
		closeShellMutate.mockClear();
	});

	it("deduplicates concurrent acquireSession calls for the same key", async () => {
		const key = buildRemoteSessionKey({
			serverId: "server-a",
			terminalId: "term-1",
		});

		const [first, second] = await Promise.all([
			useRemoteSessionsStore.getState().acquireSession({
				key,
				serverId: "server-a",
			}),
			useRemoteSessionsStore.getState().acquireSession({
				key,
				serverId: "server-a",
			}),
		]);

		expect(first).toBe(second);
		expect(openShellMutate).toHaveBeenCalledTimes(1);
		expect(useRemoteSessionsStore.getState().sessions[key]?.attachedViews).toBe(
			2,
		);
	});

	it("reuses the same session when reacquired during the grace window", async () => {
		const key = buildRemoteSessionKey({
			serverId: "server-a",
			terminalId: "term-1",
		});

		const first = await useRemoteSessionsStore.getState().acquireSession({
			key,
			serverId: "server-a",
		});
		useRemoteSessionsStore.getState().releaseSession(key);
		const second = await useRemoteSessionsStore.getState().acquireSession({
			key,
			serverId: "server-a",
		});

		expect(second).toBe(first);
		expect(openShellMutate).toHaveBeenCalledTimes(1);
		expect(closeShellMutate).not.toHaveBeenCalled();
		expect(useRemoteSessionsStore.getState().sessions[key]?.status).toBe(
			"open",
		);
	});

	it("isolates same terminal ids across workspaces", async () => {
		const firstKey = buildRemoteSessionKey({
			serverId: "server-a",
			workspaceId: "workspace-a",
			terminalId: "term-1",
		});
		const secondKey = buildRemoteSessionKey({
			serverId: "server-a",
			workspaceId: "workspace-b",
			terminalId: "term-1",
		});

		const first = await useRemoteSessionsStore.getState().acquireSession({
			key: firstKey,
			serverId: "server-a",
		});
		const second = await useRemoteSessionsStore.getState().acquireSession({
			key: secondKey,
			serverId: "server-a",
		});

		expect(first).not.toBe(second);
		expect(openShellMutate).toHaveBeenCalledTimes(2);
	});

	it("closes stale reconnect results after generation changes", async () => {
		let resolveOpen: undefined | ((value: { sessionId: string }) => void);
		openShellMutate.mockImplementationOnce(
			() =>
				new Promise<{ sessionId: string }>((resolve) => {
					resolveOpen = resolve;
				}),
		);

		const key = buildRemoteSessionKey({
			serverId: "server-a",
			workspaceId: "workspace-a",
			terminalId: "term-1",
		});

		const firstOpen = useRemoteSessionsStore.getState().acquireSession({
			key,
			serverId: "server-a",
		});
		const reconnect = useRemoteSessionsStore.getState().reconnectSession({
			key,
			serverId: "server-a",
		});

		if (!resolveOpen) {
			throw new Error("Expected resolveOpen to be assigned");
		}
		resolveOpen({ sessionId: "stale-session" });
		await firstOpen;
		await reconnect;

		expect(closeShellMutate).toHaveBeenCalledWith({
			sessionId: "stale-session",
		});
	});

	it("rejects reconnect when no terminal view is attached", async () => {
		const key = buildRemoteSessionKey({
			serverId: "server-a",
			terminalId: "term-1",
		});

		await expect(
			useRemoteSessionsStore.getState().reconnectSession({
				key,
				serverId: "server-a",
			}),
		).rejects.toThrow(
			"Cannot reconnect a remote session without an attached terminal view",
		);
		expect(openShellMutate).not.toHaveBeenCalled();
	});

	it("preserves detached sessions until explicit destroy", async () => {
		const key = buildRemoteSessionKey({
			serverId: "server-a",
			terminalId: "term-1",
		});

		const sessionId = await useRemoteSessionsStore.getState().acquireSession({
			key,
			serverId: "server-a",
		});
		useRemoteSessionsStore.getState().releaseSession(key);

		expect(useRemoteSessionsStore.getState().sessions[key]?.sessionId).toBe(
			sessionId,
		);
		expect(useRemoteSessionsStore.getState().sessions[key]?.status).toBe(
			"detached",
		);
		expect(closeShellMutate).not.toHaveBeenCalled();

		useRemoteSessionsStore.getState().destroySession(key);

		expect(closeShellMutate).toHaveBeenCalledWith({ sessionId });
		expect(useRemoteSessionsStore.getState().sessions[key]).toBeUndefined();
	});

	it("drops detached entries when the remote session closes before reattach", async () => {
		const key = buildRemoteSessionKey({
			serverId: "server-a",
			terminalId: "term-1",
		});

		const sessionId = await useRemoteSessionsStore.getState().acquireSession({
			key,
			serverId: "server-a",
		});
		useRemoteSessionsStore.getState().releaseSession(key);
		useRemoteSessionsStore.getState().markSessionClosed(key, sessionId);

		expect(useRemoteSessionsStore.getState().sessions[key]).toBeUndefined();
	});
});
