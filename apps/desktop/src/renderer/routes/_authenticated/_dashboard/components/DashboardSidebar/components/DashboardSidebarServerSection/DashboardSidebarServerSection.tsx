import type { SelectServer } from "@superset/local-db";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { env } from "renderer/env.renderer";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { getLocalSpaceWorkspaceId } from "renderer/lib/local-space-workspace";
import { useServersStore } from "renderer/stores/servers-state";
import { useTabsStore } from "renderer/stores/tabs/store";
import { extractPaneIdsFromLayout } from "renderer/stores/tabs/utils";
import { resolveServerSpaceDirectory } from "shared/server-paths";
import {
	formatSpaceDirectory,
	getDefaultHomeDirectory,
	getSpaceDisplayLabels,
	isCustomSpaceLabel,
	UNTITLED_SPACE_LABEL,
} from "shared/space-display";
import {
	type ActivePaneStatus,
	getHighestPriorityStatus,
} from "shared/tabs-types";
import { AddServerDialog } from "./AddServerDialog";
import { useServerActivity } from "./hooks/useServerActivity";
import { NewServerSpaceDialog } from "./NewServerSpaceDialog";
import { LocalServerRow, ServerGroupRow, ServerSpaceItem } from "./ServerItem";
import type { SpaceRowActivity } from "./SpaceActivityBadge";
import { mergeRowActivity } from "./utils/mergeRowActivity";

const LOCAL_SERVER_GROUP_ID = "__local__";

interface ServerGroupProps {
	server: SelectServer;
	/** Shown next to the label when another server has the same name. */
	hostHint?: string;
}

function ServerGroup({ server, hostHint }: ServerGroupProps) {
	const navigate = useNavigate();
	const utils = electronTrpc.useUtils();

	const {
		toggleServerCollapsed,
		isServerCollapsed,
		setSelectedServer,
		setSelectedSpace,
		selectedSpaceId,
	} = useServersStore();

	const isCollapsed = isServerCollapsed(server.id);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

	const { data: spaces = [] } = electronTrpc.servers.listSpaces.useQuery(
		{ serverId: server.id },
		{ refetchOnWindowFocus: false },
	);

	const spaceCount = spaces.length || 1;
	const homeDirectory =
		server.homeDirectory ?? getDefaultHomeDirectory(server.username);
	const spaceDisplay = useMemo(() => {
		const labels = getSpaceDisplayLabels(
			spaces.map((space) => ({
				id: space.id,
				label: space.label,
				directory: space.directory,
			})),
		);
		return new Map(
			spaces.map((space) => {
				const fullDirectory =
					resolveServerSpaceDirectory(space.directory, homeDirectory) ??
					undefined;
				return [
					space.id,
					{
						label: labels.get(space.id) ?? UNTITLED_SPACE_LABEL,
						customLabel: isCustomSpaceLabel(space.label) ? space.label : "",
						fullDirectory,
						displayDirectory: fullDirectory
							? formatSpaceDirectory(fullDirectory, homeDirectory)
							: undefined,
					},
				];
			}),
		);
	}, [spaces, homeDirectory]);

	const activity = useServerActivity(
		server.id,
		server.status === "connected",
		selectedSpaceId,
	);
	const rowActivity = (spaceId: string): SpaceRowActivity => {
		const space = activity.get(spaceId);
		return {
			remote: space?.summary,
			status: space?.isDone ? "review" : null,
		};
	};

	const connectMutation = electronTrpc.servers.connect.useMutation({
		onSuccess: () => {
			utils.servers.list.invalidate();
			utils.servers.get.invalidate({ id: server.id });
		},
		onError: () => {
			utils.servers.list.invalidate();
			utils.servers.get.invalidate({ id: server.id });
		},
	});

	const disconnectMutation = electronTrpc.servers.disconnect.useMutation({
		onSettled: () => {
			utils.servers.list.invalidate();
			utils.servers.get.invalidate({ id: server.id });
		},
	});

	const deleteMutation = electronTrpc.servers.delete.useMutation({
		onSettled: () => {
			utils.servers.list.invalidate();
		},
	});

	const deleteSpaceMutation = electronTrpc.servers.deleteSpace.useMutation({
		onSuccess: () => {
			utils.servers.listSpaces.invalidate({ serverId: server.id });
		},
	});

	const updateSpaceMutation = electronTrpc.servers.updateSpace.useMutation({
		onSuccess: () => {
			utils.servers.listSpaces.invalidate({ serverId: server.id });
		},
	});

	const isConnecting =
		server.status === "connecting" || connectMutation.isPending;

	const autoConnect = () => {
		if (server.status === "disconnected" && !isConnecting) {
			connectMutation.mutate({ id: server.id });
		}
	};

	const handleAddSpace = () => {
		// Opens the folder picker; nothing is created until the user submits.
		const initialDirectory =
			spaces.find((space) => space.id === selectedSpaceId)?.directory ?? "";
		setIsNewSpaceDialogOpen(true);
		setInitialDirectory(initialDirectory);
	};

	const [isNewSpaceDialogOpen, setIsNewSpaceDialogOpen] = useState(false);
	const [initialDirectory, setInitialDirectory] = useState("");

	const handleNewSpaceCreated = (space: { id: string }) => {
		setSelectedServer(server.id);
		setSelectedSpace(space.id);
		autoConnect();
		navigate({
			to: "/server/$serverId",
			params: { serverId: server.id },
			search: { space: space.id },
		});
	};

	const handleSpaceSelect = (spaceId: string) => {
		setSelectedServer(server.id);
		setSelectedSpace(spaceId);

		navigate({
			to: "/server/$serverId",
			params: { serverId: server.id },
			search: { space: spaceId },
		});
	};

	const handleSpaceClose = (spaceId: string) => {
		const nextSpaces = spaces.filter((space) => space.id !== spaceId);
		const fallbackSpaceId = nextSpaces[0]?.id;
		const wasActive = selectedSpaceId === spaceId;

		deleteSpaceMutation.mutate({ id: spaceId });

		if (wasActive) {
			setSelectedServer(server.id);
			setSelectedSpace(fallbackSpaceId ?? null);

			navigate({
				to: "/server/$serverId",
				params: { serverId: server.id },
				search: fallbackSpaceId ? { space: fallbackSpaceId } : {},
			});
		}
	};

	const handleSpaceDirectoryChange = (
		spaceId: string,
		directory: string | undefined,
	) => {
		updateSpaceMutation.mutate({ id: spaceId, directory: directory ?? null });
	};

	const handleSpaceRename = (spaceId: string, label: string) => {
		const trimmed = label.trim();
		if (!trimmed) return;
		updateSpaceMutation.mutate({ id: spaceId, label: trimmed });
	};

	const handleSpaceColorChange = (spaceId: string, color: string | null) => {
		updateSpaceMutation.mutate({ id: spaceId, color });
	};

	const handleToggleCollapse = () => {
		toggleServerCollapsed(server.id);
	};

	const handleConnect = () => {
		autoConnect();
	};

	const handleDisconnect = () => {
		disconnectMutation.mutate({ id: server.id });
	};

	const handleDelete = () => {
		deleteMutation.mutate({ id: server.id });
	};

	return (
		<div className="border-b border-border last:border-b-0">
			<ServerGroupRow
				server={server}
				isCollapsed={isCollapsed}
				spaceCount={spaceCount}
				collapsedActivity={mergeRowActivity(
					spaces.map((space) => rowActivity(space.id)),
				)}
				hostHint={hostHint}
				onToggleCollapse={handleToggleCollapse}
				onAddSpace={handleAddSpace}
				onConnect={handleConnect}
				onDisconnect={handleDisconnect}
				onEdit={() => setIsEditDialogOpen(true)}
				onDelete={handleDelete}
				isConnecting={isConnecting}
			/>

			<AddServerDialog
				open={isEditDialogOpen}
				onOpenChange={setIsEditDialogOpen}
				server={server}
			/>

			<NewServerSpaceDialog
				server={server}
				spaces={spaces}
				open={isNewSpaceDialogOpen}
				onOpenChange={setIsNewSpaceDialogOpen}
				initialDirectory={initialDirectory}
				onCreated={handleNewSpaceCreated}
				onOpenExisting={handleSpaceSelect}
			/>

			<AnimatePresence initial={false}>
				{!isCollapsed && spaces.length > 0 && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="overflow-hidden"
					>
						<div className="pb-0.5">
							{spaces.map((space) => {
								const display = spaceDisplay.get(space.id);
								const spaceActivity = rowActivity(space.id);
								return (
									<ServerSpaceItem
										key={space.id}
										label={display?.label ?? space.label}
										customLabel={display?.customLabel ?? ""}
										directory={space.directory ?? undefined}
										displayDirectory={display?.displayDirectory}
										fullDirectory={display?.fullDirectory}
										color={space.color ?? undefined}
										isActive={selectedSpaceId === space.id}
										activity={spaceActivity}
										runningTerminalCount={
											spaceActivity.remote?.terminalCount ?? 0
										}
										onSelect={() => handleSpaceSelect(space.id)}
										onClose={() => handleSpaceClose(space.id)}
										onSetDirectory={(directory) =>
											handleSpaceDirectoryChange(space.id, directory)
										}
										onRename={(label) => handleSpaceRename(space.id, label)}
										onColorChange={(color) =>
											handleSpaceColorChange(space.id, color)
										}
									/>
								);
							})}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export function DashboardSidebarServerSection() {
	if (env.SKIP_ENV_VALIDATION) {
		return <SkipModeDashboardSidebarServerSection />;
	}

	return <LiveDashboardSidebarServerSection />;
}

function LocalGroup() {
	const navigate = useNavigate();
	const matchRoute = useMatchRoute();
	const utils = electronTrpc.useUtils();
	const { data: localSpacesState } =
		electronTrpc.uiState.localSpaces.get.useQuery();
	const localSpaces = localSpacesState?.spaces ?? [];
	const createLocalSpaceState =
		electronTrpc.uiState.localSpaces.set.useMutation({
			onSuccess: () => {
				utils.uiState.localSpaces.get.invalidate();
			},
		});
	const {
		toggleServerCollapsed,
		isServerCollapsed,
		setSelectedServer,
		setSelectedSpace,
		selectedSpaceId,
	} = useServersStore();

	const currentLocalSpaceMatch = matchRoute({
		to: "/workspace/$workspaceId",
		fuzzy: true,
	});
	const activeLocalSpaceId =
		currentLocalSpaceMatch !== false
			? currentLocalSpaceMatch.workspaceId.startsWith("local-space-")
				? currentLocalSpaceMatch.workspaceId.slice("local-space-".length)
				: null
			: null;
	const { data: localHomeDirectory } = electronTrpc.window.getHomeDir.useQuery(
		undefined,
		{ staleTime: Number.POSITIVE_INFINITY },
	);
	const spaceDisplay = useMemo(() => {
		const labels = getSpaceDisplayLabels(localSpaces);
		return new Map(
			localSpaces.map((space) => [
				space.id,
				{
					label: labels.get(space.id) ?? UNTITLED_SPACE_LABEL,
					customLabel: isCustomSpaceLabel(space.label) ? space.label : "",
					displayDirectory: space.directory
						? formatSpaceDirectory(space.directory, localHomeDirectory)
						: undefined,
				},
			]),
		);
	}, [localSpaces, localHomeDirectory]);
	// Agent hook status per local space, aggregated over its panes. The selector
	// returns a string (stable by value) — returning a fresh object would
	// re-render on every store change.
	const localStatusKey = useTabsStore((state) =>
		localSpaces
			.map((space) => {
				const workspaceId = getLocalSpaceWorkspaceId(space.id);
				const statuses: Array<ActivePaneStatus | "idle" | undefined> = [];
				for (const tab of state.tabs) {
					if (tab.workspaceId !== workspaceId) continue;
					for (const paneId of extractPaneIdsFromLayout(tab.layout)) {
						statuses.push(state.panes[paneId]?.status);
					}
				}
				return `${space.id}=${getHighestPriorityStatus(statuses) ?? ""}`;
			})
			.join(","),
	);
	const localStatuses = useMemo(() => {
		const result: Record<string, ActivePaneStatus | null> = {};
		for (const entry of localStatusKey.split(",")) {
			const [spaceId, status] = entry.split("=");
			if (spaceId) result[spaceId] = (status as ActivePaneStatus) || null;
		}
		return result;
	}, [localStatusKey]);
	const isCollapsed = isServerCollapsed(LOCAL_SERVER_GROUP_ID);

	const updateSpaces = (
		nextSpaces: typeof localSpaces,
		callbacks?: { onSuccess?: () => void },
	) => {
		createLocalSpaceState.mutate(
			{ spaces: nextSpaces },
			{
				onSuccess: () => {
					callbacks?.onSuccess?.();
				},
			},
		);
	};

	const handleToggleCollapse = () => {
		toggleServerCollapsed(LOCAL_SERVER_GROUP_ID);
	};

	const handleAddSpace = () => {
		const now = Date.now();
		const nextSpace = {
			id: crypto.randomUUID(),
			label: UNTITLED_SPACE_LABEL,
			sortOrder: localSpaces.length,
			createdAt: now,
			updatedAt: now,
			lastOpenedAt: now,
		};

		updateSpaces([...localSpaces, nextSpace], {
			onSuccess: () => {
				setSelectedServer(LOCAL_SERVER_GROUP_ID);
				setSelectedSpace(nextSpace.id);
				navigate({
					to: "/workspace/$workspaceId",
					params: { workspaceId: getLocalSpaceWorkspaceId(nextSpace.id) },
				});
			},
		});
	};

	const handleSpaceSelect = (spaceId: string) => {
		setSelectedServer(LOCAL_SERVER_GROUP_ID);
		setSelectedSpace(spaceId);
		navigate({
			to: "/workspace/$workspaceId",
			params: { workspaceId: getLocalSpaceWorkspaceId(spaceId) },
		});
	};

	const handleSpaceClose = (spaceId: string) => {
		const nextSpaces = localSpaces
			.filter((space) => space.id !== spaceId)
			.map((space, index) => ({ ...space, sortOrder: index }));
		const fallbackSpaceId = nextSpaces[0]?.id ?? null;
		const wasActive =
			activeLocalSpaceId === spaceId || selectedSpaceId === spaceId;

		updateSpaces(nextSpaces, {
			onSuccess: () => {
				if (wasActive) {
					setSelectedServer(LOCAL_SERVER_GROUP_ID);
					setSelectedSpace(fallbackSpaceId);
					if (fallbackSpaceId) {
						navigate({
							to: "/workspace/$workspaceId",
							params: {
								workspaceId: getLocalSpaceWorkspaceId(fallbackSpaceId),
							},
							replace: true,
						});
					}
				}
			},
		});
	};

	const handleSpaceDirectoryChange = (
		spaceId: string,
		directory: string | undefined,
	) => {
		updateSpaces(
			localSpaces.map((space) =>
				space.id === spaceId
					? { ...space, directory, updatedAt: Date.now() }
					: space,
			),
		);
	};

	const handleSpaceRename = (spaceId: string, label: string) => {
		const trimmed = label.trim();
		if (!trimmed) return;
		updateSpaces(
			localSpaces.map((space) =>
				space.id === spaceId
					? { ...space, label: trimmed, updatedAt: Date.now() }
					: space,
			),
		);
	};

	const handleSpaceColorChange = (spaceId: string, color: string | null) => {
		updateSpaces(
			localSpaces.map((space) =>
				space.id === spaceId
					? {
							...space,
							color: color ?? undefined,
							updatedAt: Date.now(),
						}
					: space,
			),
		);
	};

	return (
		<div className="border-b border-border last:border-b-0">
			<LocalServerRow
				isCollapsed={isCollapsed}
				spaceCount={localSpaces.length || 1}
				isActive={currentLocalSpaceMatch !== false}
				collapsedActivity={mergeRowActivity(
					localSpaces.map((space) => ({ status: localStatuses[space.id] })),
				)}
				onToggleCollapse={handleToggleCollapse}
				onAddSpace={handleAddSpace}
			/>

			<AnimatePresence initial={false}>
				{!isCollapsed && localSpaces.length > 0 && (
					<motion.div
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: 0.15, ease: "easeOut" }}
						className="overflow-hidden"
					>
						<div className="pb-0.5">
							{localSpaces.map((space) => {
								const display = spaceDisplay.get(space.id);
								return (
									<ServerSpaceItem
										key={space.id}
										label={display?.label ?? space.label}
										customLabel={display?.customLabel ?? ""}
										directory={space.directory}
										displayDirectory={display?.displayDirectory}
										fullDirectory={space.directory}
										color={space.color}
										isActive={activeLocalSpaceId === space.id}
										activity={{ status: localStatuses[space.id] }}
										// Local terminals survive closing the space's tab state.
										runningTerminalCount={0}
										onSelect={() => handleSpaceSelect(space.id)}
										onClose={() => handleSpaceClose(space.id)}
										onSetDirectory={(directory) =>
											handleSpaceDirectoryChange(space.id, directory)
										}
										onRename={(label) => handleSpaceRename(space.id, label)}
										onColorChange={(color) =>
											handleSpaceColorChange(space.id, color)
										}
									/>
								);
							})}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function LiveDashboardSidebarServerSection() {
	const { data: servers = [] } = electronTrpc.servers.list.useQuery();
	const utils = electronTrpc.useUtils();

	electronTrpc.servers.onStatusChange.useSubscription(undefined, {
		onData: (event) => {
			utils.servers.list.invalidate();
			utils.servers.get.invalidate({ id: event.serverId });
		},
	});

	const reconnectAll = electronTrpc.servers.reconnectAll.useMutation({
		onSettled: () => utils.servers.list.invalidate(),
	});
	const hasReconnected = useRef(false);

	useEffect(() => {
		if (hasReconnected.current) return;
		if (servers.length === 0) return;
		hasReconnected.current = true;
		reconnectAll.mutate();
	}, [servers.length, reconnectAll.mutate]);

	const { isAddServerDialogOpen, closeAddServerDialog } = useServersStore();

	return (
		<div>
			<div className="py-0">
				<LocalGroup />

				<ServerGroups servers={servers} />
			</div>

			{servers.length === 0 && (
				<div className="flex flex-col items-center justify-center h-24 text-muted-foreground text-sm">
					<span>No remote servers yet</span>
				</div>
			)}

			<AddServerDialog
				open={isAddServerDialogOpen}
				onOpenChange={(open) => {
					if (!open) closeAddServerDialog();
				}}
			/>
		</div>
	);
}

function SkipModeDashboardSidebarServerSection() {
	const { data: servers = [] } = electronTrpc.servers.list.useQuery();
	const utils = electronTrpc.useUtils();
	const reconnectAll = electronTrpc.servers.reconnectAll.useMutation({
		onSettled: () => utils.servers.list.invalidate(),
	});
	const hasReconnected = useRef(false);

	electronTrpc.servers.onStatusChange.useSubscription(undefined, {
		onData: (event) => {
			utils.servers.list.invalidate();
			utils.servers.get.invalidate({ id: event.serverId });
		},
	});

	useEffect(() => {
		if (hasReconnected.current) return;
		if (servers.length === 0) return;
		hasReconnected.current = true;
		reconnectAll.mutate();
	}, [servers.length, reconnectAll.mutate]);

	const { isAddServerDialogOpen, closeAddServerDialog } = useServersStore();

	return (
		<div>
			<div className="py-0">
				<LocalGroup />

				<ServerGroups servers={servers} />
			</div>

			{servers.length === 0 && (
				<div className="flex flex-col items-center justify-center h-24 text-muted-foreground text-sm">
					<span>No remote servers yet</span>
				</div>
			)}

			<AddServerDialog
				open={isAddServerDialogOpen}
				onOpenChange={(open) => {
					if (!open) closeAddServerDialog();
				}}
			/>
		</div>
	);
}

/**
 * Server groups, with `user@host` shown for servers that share a label so two
 * "OVH Dev" entries are distinguishable.
 */
function ServerGroups({ servers }: { servers: SelectServer[] }) {
	const labelCounts = new Map<string, number>();
	for (const server of servers) {
		labelCounts.set(server.label, (labelCounts.get(server.label) ?? 0) + 1);
	}
	return servers.map((server) => (
		<ServerGroup
			key={server.id}
			server={server}
			hostHint={
				(labelCounts.get(server.label) ?? 0) > 1
					? `${server.username}@${server.host}`
					: undefined
			}
		/>
	));
}
