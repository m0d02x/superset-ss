import { Button } from "@superset/ui/button";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
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
	terminalId: string;
	cwd?: string;
	isActive?: boolean;
	onCwdChange?: (cwd: string) => void;
	onTitleChange?: (title: string) => void;
}

const ESC = "\x1b";
const BEL = "\x07";
const OSC7_PATTERN = new RegExp(
	`${ESC}\\]7;file://[^/]*((?:/[^${BEL}${ESC}]*)*)(?:${BEL}|${ESC}\\\\)`,
	"g",
);

function parseOsc7Cwd(data: string): string | null {
	let last: string | null = null;

	for (const match of data.matchAll(OSC7_PATTERN)) {
		const path = match[1];
		if (path) {
			try {
				last = decodeURIComponent(path);
			} catch {
				last = path;
			}
		}
	}

	return last;
}

export function SSHTerminal({
	serverId,
	terminalId,
	cwd,
	isActive = false,
	onCwdChange,
	onTitleChange,
}: SSHTerminalProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);
	const initialCwdRef = useRef(cwd);
	const cwdBufferRef = useRef("");
	const terminalRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const serializeAddonRef = useRef<SerializeAddon | null>(null);
	const cacheKey = buildRemoteSessionKey({ serverId, terminalId });
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

	const writeShell = electronTrpc.servers.writeShell.useMutation();
	const resizeShell = electronTrpc.servers.resizeShell.useMutation();
	const writeShellRef = useRef(writeShell.mutate);
	const resizeShellRef = useRef(resizeShell.mutate);
	const onCwdChangeRef = useRef(onCwdChange);
	const onTitleChangeRef = useRef(onTitleChange);

	useEffect(() => {
		writeShellRef.current = writeShell.mutate;
	}, [writeShell.mutate]);

	useEffect(() => {
		resizeShellRef.current = resizeShell.mutate;
	}, [resizeShell.mutate]);

	useEffect(() => {
		onCwdChangeRef.current = onCwdChange;
	}, [onCwdChange]);

	useEffect(() => {
		onTitleChangeRef.current = onTitleChange;
	}, [onTitleChange]);

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
					terminalRef.current?.write(msg.data);
					cwdBufferRef.current = `${cwdBufferRef.current}${msg.data}`.slice(
						-4096,
					);
					const cwdFromData = parseOsc7Cwd(cwdBufferRef.current);
					if (cwdFromData !== null) {
						onCwdChangeRef.current?.(cwdFromData);
						cwdBufferRef.current = "";
					}
				} else if (msg.type === "close") {
					terminalRef.current?.writeln("\r\n[session closed]");
					if (sessionId) {
						clearRemoteTerminalSnapshot(cacheKey);
						markSessionClosed(cacheKey, sessionId);
					}
				}
			},
		},
	);

	// Open shell and setup xterm
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

		return () => {
			if (serializeAddonRef.current) {
				saveRemoteTerminalSnapshot({
					key: cacheKey,
					serializer: serializeAddonRef.current,
				});
			}
			serializeAddonRef.current = null;
			fitAddonRef.current = null;
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
			tmuxSession: `ss-${terminalId}`,
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

		const onTitleDispose = terminal.onTitleChange((title) => {
			onTitleChangeRef.current?.(title);
		});

		const resizeObserver = new ResizeObserver(() => {
			fitAddon.fit();
			resizeShellRef.current({
				sessionId,
				cols: terminal.cols,
				rows: terminal.rows,
			});
		});
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
			onTitleDispose.dispose();
			resizeObserver.disconnect();
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("focus", handleWindowFocus);
		};

		return () => {
			cleanupRef.current?.();
			cleanupRef.current = null;
		};
	}, [sessionId]);

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const terminal = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		const container = containerRef.current;
		if (!terminal || !fitAddon || !container) {
			return;
		}

		requestAnimationFrame(() => {
			if (!terminalRef.current || terminalRef.current !== terminal) {
				return;
			}

			const rect = container.getBoundingClientRect();
			if (rect.width <= 1 || rect.height <= 1) {
				return;
			}

			const prevCols = terminal.cols;
			const prevRows = terminal.rows;
			fitAddon.fit();
			terminal.refresh(0, Math.max(0, terminal.rows - 1));
			terminal.focus();

			if (
				sessionId &&
				(terminal.cols !== prevCols || terminal.rows !== prevRows)
			) {
				resizeShellRef.current({
					sessionId,
					cols: terminal.cols,
					rows: terminal.rows,
				});
			}
		});
	}, [isActive, sessionId]);

	return (
		<div className="flex h-full w-full flex-col">
			<div className="flex items-center gap-2 border-b border-border px-3 h-10 shrink-0">
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
							tmuxSession: `ss-${terminalId}`,
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
