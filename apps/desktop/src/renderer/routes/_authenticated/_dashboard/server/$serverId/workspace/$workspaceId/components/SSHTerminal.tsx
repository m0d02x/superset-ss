import { Button } from "@superset/ui/button";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { debounce } from "lodash";
import { useCallback, useEffect, useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { RESIZE_DEBOUNCE_MS } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/config";
import {
	loadRenderer,
	type TerminalRenderer,
} from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/helpers";
import { WriteBatcher } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/write-batcher";
import {
	buildRemoteSessionKey,
	useRemoteSessionsStore,
} from "renderer/stores/remote-sessions";
import {
	clearRemoteTerminalSnapshot,
	getRemoteTerminalSnapshot,
	saveRemoteTerminalSnapshot,
} from "renderer/stores/remote-sessions/view-state";

interface SSHTerminalProps {
	serverId: string;
	workspaceId: string;
	terminalId: string;
	cwd?: string;
}

export function SSHTerminal({
	serverId,
	workspaceId,
	terminalId,
	cwd,
}: SSHTerminalProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);
	const initialCwdRef = useRef(cwd);
	const terminalRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const serializeAddonRef = useRef<SerializeAddon | null>(null);
	const rendererRef = useRef<TerminalRenderer | null>(null);
	const cacheKey = buildRemoteSessionKey({
		serverId,
		workspaceId,
		terminalId,
	});
	const sessionEntry = useRemoteSessionsStore(
		useCallback((state) => state.sessions[cacheKey] ?? null, [cacheKey]),
	);
	const acquireSession = useRemoteSessionsStore(
		(state) => state.acquireSession,
	);
	const reconnectSession = useRemoteSessionsStore(
		(state) => state.reconnectSession,
	);
	const releaseSession = useRemoteSessionsStore(
		(state) => state.releaseSession,
	);
	const markSessionClosed = useRemoteSessionsStore(
		(state) => state.markSessionClosed,
	);
	const sessionId = sessionEntry?.sessionId ?? null;
	const status = sessionEntry?.status ?? "idle";

	const batcherRef = useRef(new WriteBatcher());

	const writeShell = electronTrpc.servers.writeShell.useMutation();
	const resizeShell = electronTrpc.servers.resizeShell.useMutation();

	const writeShellRef = useRef(writeShell.mutate);
	const resizeShellRef = useRef(resizeShell.mutate);
	useEffect(() => {
		writeShellRef.current = writeShell.mutate;
	}, [writeShell.mutate]);
	useEffect(() => {
		resizeShellRef.current = resizeShell.mutate;
	}, [resizeShell.mutate]);

	useEffect(() => {
		if (!initialCwdRef.current && cwd) {
			initialCwdRef.current = cwd;
		}
	}, [cwd]);

	// Subscribe to shell output
	electronTrpc.servers.onShellData.useSubscription(
		{ sessionId: sessionId ?? "" },
		{
			enabled: !!sessionId,
			onData: (msg) => {
				if (msg.type === "data") {
					batcherRef.current.write(msg.data);
				} else if (msg.type === "close") {
					batcherRef.current.flush();
					terminalRef.current?.writeln("\r\n[session closed]");
					if (sessionId) {
						clearRemoteTerminalSnapshot(cacheKey);
						markSessionClosed(cacheKey, sessionId);
					}
				}
			},
		},
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const fitAddon = new FitAddon();
		fitAddonRef.current = fitAddon;
		const terminal = new XTerm({
			cursorBlink: true,
			allowProposedApi: true,
			fontFamily:
				'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
			fontSize: 13,
			scrollback: 1500,
			theme: {
				background: "#14100f",
				foreground: "#f5efe9",
			},
		});
		terminalRef.current = terminal;
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new ClipboardAddon());
		const serializeAddon = new SerializeAddon();
		serializeAddonRef.current = serializeAddon;
		terminal.loadAddon(serializeAddon);
		terminal.open(container);
		fitAddon.fit();
		terminal.focus();

		const snapshotAnsi = getRemoteTerminalSnapshot(cacheKey);
		if (snapshotAnsi) {
			terminal.write(snapshotAnsi);
		}

		// Load GPU renderer after open to avoid race with xterm internals
		let rendererDispose: (() => void) | null = null;
		const rendererRafId = requestAnimationFrame(() => {
			const renderer = loadRenderer(terminal);
			rendererRef.current = renderer;
			rendererDispose = renderer.dispose;
		});

		// Attach write batcher
		batcherRef.current.attach(terminal);

		return () => {
			if (serializeAddonRef.current) {
				saveRemoteTerminalSnapshot({
					key: cacheKey,
					serializer: serializeAddonRef.current,
				});
			}
			serializeAddonRef.current = null;
			fitAddonRef.current = null;
			rendererRef.current = null;
			cancelAnimationFrame(rendererRafId);
			rendererDispose?.();
			batcherRef.current.dispose();
			terminal.dispose();
			terminalRef.current = null;
		};
	}, [cacheKey]);

	useEffect(() => {
		let cancelled = false;

		void acquireSession({
			key: cacheKey,
			serverId,
			cwd: initialCwdRef.current,
			tmuxSession: `ss-${workspaceId}-${terminalId}`,
		}).catch((error) => {
			if (cancelled) {
				return;
			}
			terminalRef.current?.writeln(
				`\r\n\x1b[31mFailed to open shell: ${error instanceof Error ? error.message : String(error)}\x1b[0m`,
			);
		});

		return () => {
			cancelled = true;
			releaseSession(cacheKey);
		};
	}, [acquireSession, cacheKey, releaseSession, serverId]);

	useEffect(() => {
		const container = containerRef.current;
		const terminal = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		if (!container || !terminal || !fitAddon || !sessionId) {
			cleanupRef.current = null;
			return;
		}

		const onDataDispose = terminal.onData((data) => {
			writeShellRef.current({ sessionId, data });
		});

		const debouncedResize = debounce(() => {
			fitAddon.fit();
			resizeShellRef.current({
				sessionId,
				cols: terminal.cols,
				rows: terminal.rows,
			});
		}, RESIZE_DEBOUNCE_MS);
		const resizeObserver = new ResizeObserver(debouncedResize);
		resizeObserver.observe(container);

		const isRenderable = () => {
			const rect = container.getBoundingClientRect();
			return rect.width > 1 && rect.height > 1;
		};

		const recoverVisibility = (forceResize: boolean) => {
			if (!isRenderable()) return;
			const prevCols = terminal.cols;
			const prevRows = terminal.rows;
			const wasAtBottom =
				terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;

			rendererRef.current?.clearTextureAtlas?.();

			fitAddon.fit();
			terminal.refresh(0, Math.max(0, terminal.rows - 1));

			if (
				forceResize ||
				terminal.cols !== prevCols ||
				terminal.rows !== prevRows
			) {
				resizeShellRef.current({
					sessionId,
					cols: terminal.cols,
					rows: terminal.rows,
				});
			}

			if (!wasAtBottom) return;
			requestAnimationFrame(() => {
				if (terminalRef.current !== terminal) return;
				terminal.scrollToBottom();
			});
		};

		const handleVisibilityChange = () => {
			if (document.hidden) return;
			recoverVisibility(true);
		};

		const handleWindowFocus = () => {
			recoverVisibility(true);
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		window.addEventListener("focus", handleWindowFocus);

		cleanupRef.current = () => {
			onDataDispose.dispose();
			debouncedResize.cancel();
			resizeObserver.disconnect();
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("focus", handleWindowFocus);
		};

		return () => {
			cleanupRef.current?.();
			cleanupRef.current = null;
		};
	}, [sessionId]);

	return (
		<div className="flex h-full w-full flex-col">
			<div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
				<span className="text-xs text-muted-foreground">
					{status === "open"
						? "SSH Shell"
						: status === "opening" || status === "idle"
							? "Opening shell..."
							: "Disconnected"}
				</span>
				{cwd && (
					<span className="text-xs text-muted-foreground/60 truncate max-w-80">
						{cwd}
					</span>
				)}
				<Button
					size="sm"
					variant="ghost"
					className="ml-auto h-6 text-xs"
					onClick={() => {
						cleanupRef.current?.();
						cleanupRef.current = null;
						clearRemoteTerminalSnapshot(cacheKey);
						void reconnectSession({
							key: cacheKey,
							serverId,
							cwd: initialCwdRef.current,
							tmuxSession: `ss-${workspaceId}-${terminalId}`,
						}).catch((error) => {
							terminalRef.current?.writeln(
								`\r\n\x1b[31mFailed to reopen shell: ${error instanceof Error ? error.message : String(error)}\x1b[0m`,
							);
						});
					}}
				>
					Reconnect
				</Button>
			</div>
			<div
				ref={containerRef}
				className="flex-1 min-h-0 min-w-0 overflow-hidden bg-[#14100f] p-1"
			/>
		</div>
	);
}
