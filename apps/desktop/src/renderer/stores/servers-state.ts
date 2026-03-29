import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export interface ServerTerminal {
	id: string;
	label: string;
}

export interface ServerSpace {
	id: string;
	label: string;
	directory?: string;
	terminals: ServerTerminal[];
}

export interface ServersState {
	selectedServerId: string | null;
	selectedSpaceId: string | null;
	isAddServerDialogOpen: boolean;
	serverSpaces: Record<string, ServerSpace[]>;
	collapsedServers: Record<string, boolean>;
	terminalCwds: Record<string, string>;
	isServersCollapsed: boolean;

	setSelectedServer: (id: string | null) => void;
	setSelectedSpace: (id: string | null) => void;
	openAddServerDialog: () => void;
	closeAddServerDialog: () => void;
	toggleServersCollapsed: () => void;
	toggleServerCollapsed: (serverId: string) => void;
	isServerCollapsed: (serverId: string) => boolean;

	addSpace: (serverId: string) => ServerSpace;
	removeSpace: (serverId: string, spaceId: string) => void;
	setSpaceDirectory: (
		serverId: string,
		spaceId: string,
		directory: string | undefined,
	) => void;
	renameSpace: (serverId: string, spaceId: string, label: string) => void;
	getSpaces: (serverId: string) => ServerSpace[];
	ensureDefaultSpace: (serverId: string) => ServerSpace[];

	addTerminalToSpace: (serverId: string, spaceId: string) => ServerTerminal;
	removeTerminalFromSpace: (
		serverId: string,
		spaceId: string,
		terminalId: string,
	) => void;
	getSpaceTerminals: (serverId: string, spaceId: string) => ServerTerminal[];
	setTerminalCwd: (terminalId: string, cwd: string) => void;
	getTerminalCwd: (terminalId: string) => string | undefined;
}

let terminalCounter = 0;
let spaceCounter = 0;

const createDefaultTerminal = (): ServerTerminal => {
	terminalCounter += 1;
	return {
		id: `term-${terminalCounter}`,
		label: `Terminal ${terminalCounter}`,
	};
};

const createDefaultSpace = (): ServerSpace => {
	spaceCounter += 1;
	return {
		id: `space-${spaceCounter}`,
		label: `Space ${spaceCounter}`,
		terminals: [createDefaultTerminal()],
	};
};

const selectSpaces = (state: ServersState, serverId: string): ServerSpace[] => {
	return state.serverSpaces[serverId] || [];
};

export const useServersStore = create<ServersState>()(
	devtools(
		persist(
			(set, get) => ({
				selectedServerId: null,
				selectedSpaceId: null,
				isAddServerDialogOpen: false,
				serverSpaces: {},
				collapsedServers: {},
				terminalCwds: {},
				isServersCollapsed: false,

				setSelectedServer: (id) => set({ selectedServerId: id }),
				setSelectedSpace: (id) => set({ selectedSpaceId: id }),
				openAddServerDialog: () => set({ isAddServerDialogOpen: true }),
				closeAddServerDialog: () => set({ isAddServerDialogOpen: false }),
				toggleServersCollapsed: () =>
					set((state) => ({ isServersCollapsed: !state.isServersCollapsed })),

				addSpace: (serverId) => {
					const space = createDefaultSpace();

					set((state) => ({
						serverSpaces: {
							...state.serverSpaces,
							[serverId]: [...selectSpaces(state, serverId), space],
						},
					}));

					return space;
				},

				removeSpace: (serverId, spaceId) => {
					set((state) => {
						const currentSpaces = selectSpaces(state, serverId);
						const nextSpaces = currentSpaces.filter(
							(space) => space.id !== spaceId,
						);

						if (nextSpaces.length > 0) {
							return {
								serverSpaces: {
									...state.serverSpaces,
									[serverId]: nextSpaces,
								},
								selectedSpaceId:
									state.selectedSpaceId === spaceId
										? (nextSpaces[0]?.id ?? null)
										: state.selectedSpaceId,
							};
						}

						const fallbackSpace = createDefaultSpace();
						return {
							serverSpaces: {
								...state.serverSpaces,
								[serverId]: [fallbackSpace],
							},
							selectedSpaceId:
								state.selectedSpaceId === spaceId
									? fallbackSpace.id
									: state.selectedSpaceId,
						};
					});
				},

				setSpaceDirectory: (serverId, spaceId, directory) => {
					const normalizedDirectory = directory?.trim() || undefined;

					set((state) => {
						const currentSpaces = selectSpaces(state, serverId);
						const nextSpaces = currentSpaces.map((space) => {
							if (space.id !== spaceId) {
								return space;
							}

							return {
								...space,
								directory: normalizedDirectory,
							};
						});

						return {
							serverSpaces: {
								...state.serverSpaces,
								[serverId]: nextSpaces,
							},
						};
					});
				},

				renameSpace: (serverId, spaceId, label) => {
					const trimmedLabel = label.trim();
					if (!trimmedLabel) return;

					set((state) => {
						const currentSpaces = selectSpaces(state, serverId);
						const nextSpaces = currentSpaces.map((space) => {
							if (space.id !== spaceId) {
								return space;
							}

							return {
								...space,
								label: trimmedLabel,
							};
						});

						return {
							serverSpaces: {
								...state.serverSpaces,
								[serverId]: nextSpaces,
							},
						};
					});
				},

				getSpaces: (serverId) => {
					return selectSpaces(get(), serverId);
				},

				ensureDefaultSpace: (serverId) => {
					const spaces = selectSpaces(get(), serverId);

					if (spaces.length === 0) {
						const space = createDefaultSpace();
						set((state) => ({
							serverSpaces: {
								...state.serverSpaces,
								[serverId]: [space],
							},
						}));

						return [space];
					}

					return spaces;
				},

				addTerminalToSpace: (serverId, spaceId) => {
					const terminal = createDefaultTerminal();

					set((state) => {
						let didAddTerminal = false;
						const currentSpaces = selectSpaces(state, serverId);
						const nextSpaces = currentSpaces.map((space) => {
							if (space.id !== spaceId) {
								return space;
							}

							didAddTerminal = true;
							return {
								...space,
								terminals: [...space.terminals, terminal],
							};
						});

						if (!didAddTerminal) {
							return state;
						}

						return {
							serverSpaces: {
								...state.serverSpaces,
								[serverId]: nextSpaces,
							},
						};
					});

					return terminal;
				},

				removeTerminalFromSpace: (serverId, spaceId, terminalId) => {
					set((state) => {
						const currentSpaces = selectSpaces(state, serverId);
						const nextSpaces = currentSpaces.map((space) => {
							if (space.id !== spaceId) {
								return space;
							}

							const remainingTerminals = space.terminals.filter(
								(terminal) => terminal.id !== terminalId,
							);

							return {
								...space,
								terminals:
									remainingTerminals.length === 0
										? [createDefaultTerminal()]
										: remainingTerminals,
							};
						});

						return {
							serverSpaces: {
								...state.serverSpaces,
								[serverId]: nextSpaces,
							},
							terminalCwds: Object.fromEntries(
								Object.entries(state.terminalCwds).filter(
									([id]) => id !== terminalId,
								),
							),
						};
					});
				},

				getSpaceTerminals: (serverId, spaceId) => {
					const spaces = selectSpaces(get(), serverId);
					const space = spaces.find(
						(candidateSpace) => candidateSpace.id === spaceId,
					);
					return space?.terminals || [];
				},

				setTerminalCwd: (terminalId, cwd) =>
					set((state) => ({
						terminalCwds: {
							...state.terminalCwds,
							[terminalId]: cwd,
						},
					})),
				getTerminalCwd: (terminalId) => get().terminalCwds[terminalId],

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
			{
				name: "servers-state-v2",
				version: 2,
				partialize: (state) => ({
					serverSpaces: state.serverSpaces,
					collapsedServers: state.collapsedServers,
				}),
			},
		),
		{ name: "servers-state-v2" },
	),
);
