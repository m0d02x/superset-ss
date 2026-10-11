export interface PersistedServerTerminalSession {
	terminalId: string;
	label: string | null;
	tmuxSessionName: string;
	sortOrder: number;
	isSelected: boolean | null;
}

export interface DiscoveredServerTerminalSession {
	terminalId: string;
	label: string | null;
}

export interface RestoredServerTerminals {
	terminals: Array<{ id: string; label: string }>;
	selectedTerminalId: string | null;
	tmuxOverrides: Array<[string, string]>;
}

function defaultTerminalLabel(terminalId: string): string {
	const number = terminalId.replace("term-", "");
	return `Terminal ${number}`;
}

export function buildRestoredServerTerminals({
	spaceId,
	persisted,
	discovered,
}: {
	spaceId: string;
	persisted: PersistedServerTerminalSession[];
	discovered: DiscoveredServerTerminalSession[];
}): RestoredServerTerminals {
	if (persisted.length > 0) {
		const ordered = [...persisted].sort((a, b) => a.sortOrder - b.sortOrder);
		const terminals = ordered.map((session) => ({
			id: session.terminalId,
			label: session.label || defaultTerminalLabel(session.terminalId),
		}));
		const selectedTerminalId =
			ordered.find((session) => session.isSelected)?.terminalId ??
			terminals[0]?.id ??
			null;

		return {
			terminals,
			selectedTerminalId,
			tmuxOverrides: ordered.map((session) => [
				`${spaceId}:${session.terminalId}`,
				session.tmuxSessionName,
			]),
		};
	}

	const terminals = discovered.map((session) => ({
		id: session.terminalId,
		label: session.label || defaultTerminalLabel(session.terminalId),
	}));

	return {
		terminals,
		selectedTerminalId: terminals[0]?.id ?? null,
		tmuxOverrides: [],
	};
}
