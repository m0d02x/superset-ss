import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface ServerTerminal {
	id: string;
	label: string;
}

export interface ServersState {
	selectedServerId: string | null;
	selectedSpaceId: string | null;
	selectedTerminalBySpace: Record<string, string | null>;
	isAddServerDialogOpen: boolean;
	collapsedServers: Record<string, boolean>;
	isServersCollapsed: boolean;

	// Ephemeral terminal state (not persisted to DB)
	spaceTerminals: Record<string, ServerTerminal[]>; // keyed by spaceId
	terminalCwds: Record<string, string>;

	setSelectedServer: (id: string | null) => void;
	setSelectedSpace: (id: string | null) => void;
	openAddServerDialog: () => void;
	closeAddServerDialog: () => void;
	toggleServersCollapsed: () => void;
	toggleServerCollapsed: (serverId: string) => void;
	isServerCollapsed: (serverId: string) => boolean;

	addTerminalToSpace: (spaceId: string) => ServerTerminal;
	removeTerminalFromSpace: (spaceId: string, terminalId: string) => void;
	getSpaceTerminals: (spaceId: string) => ServerTerminal[];
	setSelectedTerminalForSpace: (
		spaceId: string,
		terminalId: string | null,
	) => void;
	getSelectedTerminalForSpace: (spaceId: string) => string | null;
	setTerminalCwd: (terminalId: string, cwd: string) => void;
	getTerminalCwd: (terminalId: string) => string | undefined;
	setTerminalLabel: (
		spaceId: string,
		terminalId: string,
		label: string,
	) => void;
	restoreTerminalsForSpace: (
		spaceId: string,
		terminalIds: string[],
		labels?: Record<string, string>,
		selectedTerminalId?: string | null,
	) => void;
}

let terminalCounter = 0;

const createDefaultTerminal = (): ServerTerminal => {
	terminalCounter += 1;
	return {
		id: `term-${terminalCounter}`,
		label: `Terminal ${terminalCounter}`,
	};
};

export const useServersStore = create<ServersState>()(
	devtools(
		(set, get) => ({
			selectedServerId: null,
			selectedSpaceId: null,
			selectedTerminalBySpace: {},
			isAddServerDialogOpen: false,
			collapsedServers: {},
			isServersCollapsed: false,
			spaceTerminals: {},
			terminalCwds: {},

			setSelectedServer: (id) => set({ selectedServerId: id }),
			setSelectedSpace: (id) => set({ selectedSpaceId: id }),
			openAddServerDialog: () => set({ isAddServerDialogOpen: true }),
			closeAddServerDialog: () => set({ isAddServerDialogOpen: false }),
			toggleServersCollapsed: () =>
				set((state) => ({ isServersCollapsed: !state.isServersCollapsed })),

			addTerminalToSpace: (spaceId) => {
				const terminal = createDefaultTerminal();

				set((state) => {
					const current = state.spaceTerminals[spaceId] || [];
					return {
						spaceTerminals: {
							...state.spaceTerminals,
							[spaceId]: [...current, terminal],
						},
						selectedTerminalBySpace: {
							...state.selectedTerminalBySpace,
							[spaceId]: terminal.id,
						},
					};
				});

				return terminal;
			},

			removeTerminalFromSpace: (spaceId, terminalId) => {
				set((state) => {
					const current = state.spaceTerminals[spaceId] || [];
					const nextTerminals = current.filter((t) => t.id !== terminalId);
					const selectedTerminal = state.selectedTerminalBySpace[spaceId];
					return {
						spaceTerminals: {
							...state.spaceTerminals,
							[spaceId]: nextTerminals,
						},
						selectedTerminalBySpace: {
							...state.selectedTerminalBySpace,
							[spaceId]:
								selectedTerminal === terminalId
									? (nextTerminals[0]?.id ?? null)
									: (selectedTerminal ?? null),
						},
						terminalCwds: Object.fromEntries(
							Object.entries(state.terminalCwds).filter(
								([id]) => id !== terminalId,
							),
						),
					};
				});
			},

			getSpaceTerminals: (spaceId) => {
				return get().spaceTerminals[spaceId] || [];
			},

			setSelectedTerminalForSpace: (spaceId, terminalId) =>
				set((state) => ({
					selectedTerminalBySpace: {
						...state.selectedTerminalBySpace,
						[spaceId]: terminalId,
					},
				})),
			getSelectedTerminalForSpace: (spaceId) =>
				get().selectedTerminalBySpace[spaceId] ?? null,

			setTerminalCwd: (terminalId, cwd) =>
				set((state) => ({
					terminalCwds: {
						...state.terminalCwds,
						[terminalId]: cwd,
					},
				})),
			getTerminalCwd: (terminalId) => get().terminalCwds[terminalId],

			setTerminalLabel: (spaceId, terminalId, label) =>
				set((state) => {
					const current = state.spaceTerminals[spaceId];
					if (!current) return state;
					return {
						spaceTerminals: {
							...state.spaceTerminals,
							[spaceId]: current.map((t) =>
								t.id === terminalId ? { ...t, label } : t,
							),
						},
					};
				}),

			restoreTerminalsForSpace: (
				spaceId,
				terminalIds,
				labels = {},
				selectedTerminalId,
			) => {
				if (terminalIds.length === 0) return;

				// Update the module-level counter past the highest restored id
				const maxNum = Math.max(
					...terminalIds.map((id) => {
						const n = Number.parseInt(id.replace("term-", ""), 10);
						return Number.isNaN(n) ? 0 : n;
					}),
				);
				if (maxNum > terminalCounter) {
					terminalCounter = maxNum;
				}

				const terminals: ServerTerminal[] = terminalIds.map((id) => {
					const label = labels[id] ?? `Terminal ${id.replace("term-", "")}`;
					return { id, label };
				});

				set((state) => ({
					spaceTerminals: {
						...state.spaceTerminals,
						[spaceId]: terminals,
					},
					selectedTerminalBySpace: {
						...state.selectedTerminalBySpace,
						[spaceId]: selectedTerminalId ?? terminals[0].id,
					},
				}));
			},

			toggleServerCollapsed: (serverId) =>
				set((state) => ({
					collapsedServers: {
						...state.collapsedServers,
						[serverId]: !state.collapsedServers[serverId],
					},
				})),

			isServerCollapsed: (serverId) => {
				return get().collapsedServers[serverId] ?? true;
			},
		}),
		{ name: "servers-state" },
	),
);
