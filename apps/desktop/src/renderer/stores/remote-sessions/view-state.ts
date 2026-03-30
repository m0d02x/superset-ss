import type { SerializeAddon } from "@xterm/addon-serialize";

const MAX_SNAPSHOT_LENGTH = 200_000;

type RemoteTerminalViewState = {
	snapshotAnsi: string;
};

const remoteTerminalViewState = new Map<string, RemoteTerminalViewState>();

export function saveRemoteTerminalSnapshot(params: {
	key: string;
	serializer: SerializeAddon;
}): void {
	const snapshotAnsi = params.serializer.serialize({ scrollback: 1000 });
	remoteTerminalViewState.set(params.key, {
		snapshotAnsi: snapshotAnsi.slice(-MAX_SNAPSHOT_LENGTH),
	});
}

export function getRemoteTerminalSnapshot(key: string): string | null {
	return remoteTerminalViewState.get(key)?.snapshotAnsi ?? null;
}

export function clearRemoteTerminalSnapshot(key: string): void {
	remoteTerminalViewState.delete(key);
}
