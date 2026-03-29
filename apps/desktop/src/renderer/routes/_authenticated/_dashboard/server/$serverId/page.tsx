import { Button } from "@superset/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { useAppHotkey } from "renderer/stores/hotkeys";
import { useServersStore } from "renderer/stores/servers-state";
import { SSHTerminal } from "./components/SSHTerminal";

interface ServerSearchParams {
	space?: string;
	tab?: string;
}

export const Route = createFileRoute(
	"/_authenticated/_dashboard/server/$serverId/",
)({
	component: ServerPage,
	validateSearch: (search: Record<string, unknown>): ServerSearchParams => ({
		space: typeof search.space === "string" ? search.space : undefined,
		tab: typeof search.tab === "string" ? search.tab : undefined,
	}),
});

function ServerPage() {
	const { serverId } = Route.useParams();
	const { space: spaceId, tab: tabParam } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { data: server } = electronTrpc.servers.get.useQuery(
		{ id: serverId },
		{ refetchInterval: 2000 },
	);

	const {
		serverSpaces,
		addTerminalToSpace,
		removeTerminalFromSpace,
		setSelectedServer,
		setSelectedSpace,
		terminalCwds,
		setTerminalCwd,
	} = useServersStore();

	useEffect(() => {
		setSelectedSpace(spaceId || null);
		return () => {
			setSelectedSpace(null);
		};
	}, [setSelectedSpace, spaceId]);

	const tabs = useMemo(() => {
		const spaces = serverSpaces[serverId] || [];
		const activeSpace = spaces.find(
			(candidateSpace) => candidateSpace.id === spaceId,
		);
		return activeSpace?.terminals || [];
	}, [serverId, serverSpaces, spaceId]);

	const allSpaces = useMemo(() => {
		return serverSpaces[serverId] || [];
	}, [serverId, serverSpaces]);

	const activeSpace = useMemo(() => {
		const spaces = serverSpaces[serverId] || [];
		return (
			spaces.find((candidateSpace) => candidateSpace.id === spaceId) || null
		);
	}, [serverId, serverSpaces, spaceId]);

	const activeTabId = useMemo(() => {
		if (tabParam && tabs.some((t) => t.id === tabParam)) {
			return tabParam;
		}
		return tabs[0]?.id || null;
	}, [tabParam, tabs]);

	useEffect(() => {
		setSelectedServer(serverId);
		return () => setSelectedServer(null);
	}, [serverId, setSelectedServer]);

	const handleAddTerminal = useCallback(() => {
		if (!spaceId || !activeSpace) {
			return;
		}

		const inheritedCwd =
			activeSpace.directory ||
			(activeTabId ? terminalCwds[activeTabId] : undefined);

		const terminal = addTerminalToSpace(serverId, spaceId);
		if (inheritedCwd) {
			setTerminalCwd(terminal.id, inheritedCwd);
		}
		navigate({
			search: { space: spaceId, tab: terminal.id },
		});
	}, [
		activeSpace,
		activeTabId,
		addTerminalToSpace,
		navigate,
		serverId,
		setTerminalCwd,
		spaceId,
		terminalCwds,
	]);

	useAppHotkey(
		"NEW_GROUP",
		() => {
			handleAddTerminal();
		},
		{ preventDefault: true },
	);

	const handleCloseTab = useCallback(
		(terminalId: string) => {
			if (!spaceId || !activeSpace) {
				return;
			}

			const wasActive = activeTabId === terminalId;
			removeTerminalFromSpace(serverId, spaceId, terminalId);

			if (wasActive) {
				const remainingTabs = tabs.filter((t) => t.id !== terminalId);
				const newActiveId = remainingTabs[0]?.id;
				if (newActiveId) {
					navigate({ search: { space: spaceId, tab: newActiveId } });
				} else {
					navigate({ search: { space: spaceId } });
				}
			}
		},
		[
			activeTabId,
			activeSpace,
			removeTerminalFromSpace,
			navigate,
			serverId,
			spaceId,
			tabs,
		],
	);

	if (!server) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Server not found
			</div>
		);
	}

	if (!spaceId || !activeSpace) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Select a space from the sidebar
			</div>
		);
	}

	if (server.status === "connecting") {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Connecting to {server.label}...
			</div>
		);
	}

	if (server.status !== "connected") {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
				<p className="text-sm font-medium">{server.label}</p>
				<p className="text-xs">
					{server.status === "error"
						? `Error: ${server.statusMessage}`
						: "Not connected"}
				</p>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<div className="flex shrink-0 items-center border-b border-border bg-muted/30">
				<div className="flex flex-1 items-center overflow-x-auto hide-scrollbar">
					{tabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							className={`group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5 text-xs transition-colors ${
								activeTabId === tab.id
									? "bg-background text-foreground"
									: "text-muted-foreground hover:bg-background/50 hover:text-foreground"
							}`}
							onClick={() => {
								navigate({ search: { space: spaceId, tab: tab.id } });
							}}
						>
							<span className="max-w-32 truncate">{tab.label}</span>
							<button
								type="button"
								className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
								onClick={(e) => {
									e.stopPropagation();
									handleCloseTab(tab.id);
								}}
								tabIndex={-1}
							>
								<X className="size-3" />
							</button>
						</button>
					))}
				</div>

				<div className="flex shrink-0 items-center gap-0.5 px-2">
					<Button
						variant="ghost"
						size="icon"
						className="size-6"
						onClick={handleAddTerminal}
						title="New Terminal"
					>
						<Plus className="size-3.5" />
					</Button>
				</div>

				<div className="flex shrink-0 items-center gap-2 border-l border-border px-3">
					<div className="size-1.5 rounded-full bg-emerald-500" />
					<span className="text-[10px] text-muted-foreground">
						{activeSpace.label} · {server.label}
					</span>
				</div>
			</div>

			<div className="relative flex-1">
				{allSpaces.flatMap((space) =>
					space.terminals.map((terminal) => {
						const isVisible =
							space.id === spaceId && terminal.id === activeTabId;

						return (
							<div
								key={terminal.id}
								className={`absolute inset-0 ${isVisible ? "" : "invisible pointer-events-none"}`}
							>
								<SSHTerminal
									serverId={serverId}
									terminalId={terminal.id}
									cwd={terminalCwds[terminal.id]}
									onCwdChange={(cwd) => setTerminalCwd(terminal.id, cwd)}
								/>
							</div>
						);
					}),
				)}
			</div>
		</div>
	);
}
