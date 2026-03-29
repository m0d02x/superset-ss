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
		addSpace,
		removeSpace,
		setSpaceDirectory,
		renameSpace,
		toggleServerCollapsed,
		isServerCollapsed,
		ensureDefaultSpace,
		setSelectedServer,
		setSelectedSpace,
		selectedSpaceId,
	} = useServersStore();

	const isCollapsed = isServerCollapsed(server.id);
	const spaces = useServersStore(
		(state) => state.serverSpaces[server.id] || [],
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

	const isConnecting =
		server.status === "connecting" || connectMutation.isPending;

	const autoConnect = () => {
		if (server.status === "disconnected" && !isConnecting) {
			connectMutation.mutate({ id: server.id });
		}
	};

	const handleAddSpace = () => {
		const space = addSpace(server.id);
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

		removeSpace(server.id, spaceId);

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
		setSpaceDirectory(server.id, spaceId, directory);
	};

	const handleSpaceRename = (spaceId: string, label: string) => {
		renameSpace(server.id, spaceId, label);
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

	useEffect(() => {
		ensureDefaultSpace(server.id);
	}, [server.id, ensureDefaultSpace]);

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
									directory={space.directory}
									isActive={selectedSpaceId === space.id}
									onSelect={() => handleSpaceSelect(space.id)}
									onClose={() => handleSpaceClose(space.id)}
									onSetDirectory={(directory) =>
										handleSpaceDirectoryChange(space.id, directory)
									}
									onRename={(label) => handleSpaceRename(space.id, label)}
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
		<div className="border-t border-border">
			{servers.length === 0 ? (
				<div className="px-1 py-1">
					<button
						type="button"
						className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors text-left"
						onClick={openAddServerDialog}
					>
						Add a server...
					</button>
				</div>
			) : (
				<div className="py-0">
					{servers.map((server) => (
						<ServerGroup key={server.id} server={server} />
					))}
					<div className="px-1 py-1">
						<button
							type="button"
							className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors text-left"
							onClick={openAddServerDialog}
						>
							Add a server...
						</button>
					</div>
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
