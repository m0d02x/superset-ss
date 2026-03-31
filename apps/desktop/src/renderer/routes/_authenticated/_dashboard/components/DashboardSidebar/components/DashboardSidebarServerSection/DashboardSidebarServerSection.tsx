import type { SelectServer } from "@superset/local-db";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useServersStore } from "renderer/stores/servers-state";
import { AddServerDialog } from "./AddServerDialog";
import { ServerGroupRow, ServerSpaceItem } from "./ServerItem";

interface ServerGroupProps {
	server: SelectServer;
}

function ServerGroup({ server }: ServerGroupProps) {
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

	const { data: spaces = [] } = electronTrpc.servers.listSpaces.useQuery(
		{ serverId: server.id },
		{ refetchOnWindowFocus: false },
	);

	const spaceCount = spaces.length || 1;

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

	const createSpaceMutation = electronTrpc.servers.createSpace.useMutation({
		onSuccess: () => {
			utils.servers.listSpaces.invalidate({ serverId: server.id });
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
		createSpaceMutation.mutate(
			{ serverId: server.id, label: `Space ${spaces.length + 1}` },
			{
				onSuccess: (space) => {
					setSelectedServer(server.id);
					setSelectedSpace(space.id);
					autoConnect();

					navigate({
						to: "/server/$serverId",
						params: { serverId: server.id },
						search: { space: space.id },
					});
				},
			},
		);
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

	const handleSpaceColorChange = (
		spaceId: string,
		color: string | null,
	) => {
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
				onToggleCollapse={handleToggleCollapse}
				onAddSpace={handleAddSpace}
				onConnect={handleConnect}
				onDisconnect={handleDisconnect}
				onDelete={handleDelete}
				isConnecting={isConnecting}
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
							{spaces.map((space) => (
								<ServerSpaceItem
									key={space.id}
									serverId={server.id}
									spaceId={space.id}
									label={space.label}
									directory={space.directory ?? undefined}
									color={space.color ?? undefined}
									isActive={selectedSpaceId === space.id}
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
							))}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

export function DashboardSidebarServerSection() {
	const { data: servers = [] } = electronTrpc.servers.list.useQuery();
	const utils = electronTrpc.useUtils();
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

	const { isAddServerDialogOpen, openAddServerDialog, closeAddServerDialog } =
		useServersStore();

	return (
		<div>
			{servers.length === 0 ? (
				<div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
					<span>No servers yet</span>
				</div>
			) : (
				<div className="py-0">
					{servers.map((server) => (
						<ServerGroup key={server.id} server={server} />
					))}
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
