import { Button } from "@superset/ui/button";
import type { FitAddon, Terminal } from "ghostty-web";
import { useCallback, useEffect, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import {
	buildRemoteSessionKey,
	useRemoteSessionsStore,
} from "renderer/stores/remote-sessions";
import { clearRemoteTerminalSnapshot } from "renderer/stores/remote-sessions/view-state";

interface GhosttySSHTerminalProps {
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

type GhosttyModule = {
	init: () => Promise<void>;
	Terminal: typeof Terminal;
	FitAddon: typeof FitAddon;
};

/**
 * Safely call a ghostty terminal method. WASM panics (unreachable traps) crash
 * the renderer process and cannot be caught, so we guard every call with a
 * visibility + disposed check first. JS-level throws from ghostty-web (e.g.
 * "Terminal has been disposed") ARE catchable and we swallow them here.
 */
function safeTerminalCall(
	terminal: Terminal | null,
	fn: (t: Terminal) => void,
): boolean {
	if (!terminal) return false;
	try {
		fn(terminal);
		return true;
	} catch (err) {
		console.warn("[GhosttySSHTerminal] terminal call failed:", err);
		return false;
	}
}

export function GhosttySSHTerminal({
	serverId,
	terminalId,
	cwd,
	isActive = false,
	onCwdChange,
	onTitleChange,
}: GhosttySSHTerminalProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);
	const initialCwdRef = useRef(cwd);
	const cwdBufferRef = useRef("");
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const [ghosttyReady, setGhosttyReady] = useState(false);
	const ghosttyModuleRef = useRef<GhosttyModule | null>(null);
	const cacheKey = buildRemoteSessionKey({ serverId, terminalId });

	// Visibility gate: when the document is hidden (macOS space switch, tab
	// switch, etc.) we must NOT call any ghostty terminal methods. The WASM
	// module can panic/abort when operating on a surface whose backing canvas
	// is in a detached or zero-size state. Instead we buffer incoming data and
	// flush it when the document becomes visible again.
	const hiddenRef = useRef(document.hidden);
	const pendingWritesRef = useRef<string[]>([]);

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

	// Lazy-load ghostty-web WASM module
	useEffect(() => {
		let cancelled = false;

		async function loadGhostty() {
			try {
				const mod = await import("ghostty-web");
				if (cancelled) return;
				await mod.init();
				if (cancelled) return;
				ghosttyModuleRef.current = mod as GhosttyModule;
				setGhosttyReady(true);
			} catch (error) {
				console.error(
					"[GhosttySSHTerminal] Failed to load ghostty-web:",
					error,
				);
			}
		}

		void loadGhostty();

		return () => {
			cancelled = true;
		};
	}, []);

	// Subscribe to shell output — buffer writes while hidden
	electronTrpc.servers.onShellData.useSubscription(
		{ sessionId: sessionId ?? "" },
		{
			enabled: !!sessionId,
			onData: (msg) => {
				if (msg.type === "data") {
					if (hiddenRef.current) {
						// Buffer data while hidden to avoid WASM calls on inactive surface
						pendingWritesRef.current.push(msg.data);
					} else {
						safeTerminalCall(terminalRef.current, (t) =>
							t.write(msg.data),
						);
					}
					cwdBufferRef.current = `${cwdBufferRef.current}${msg.data}`.slice(
						-4096,
					);
					const cwdFromData = parseOsc7Cwd(cwdBufferRef.current);
					if (cwdFromData !== null) {
						onCwdChangeRef.current?.(cwdFromData);
						cwdBufferRef.current = "";
					}
				} else if (msg.type === "close") {
					if (!hiddenRef.current) {
						safeTerminalCall(terminalRef.current, (t) =>
							t.writeln("\r\n[session closed]"),
						);
					}
					if (sessionId) {
						clearRemoteTerminalSnapshot(cacheKey);
						markSessionClosed(cacheKey, sessionId);
					}
				}
			},
		},
	);

	// Open shell and setup ghostty terminal
	useEffect(() => {
		const container = containerRef.current;
		const mod = ghosttyModuleRef.current;
		if (!container || !mod || !ghosttyReady) return;

		const fitAddon = new mod.FitAddon();
		fitAddonRef.current = fitAddon;
		const terminal = new mod.Terminal({
			cursorBlink: true,
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
		terminal.open(container);
		fitAddon.fit();
		terminal.focus();

		return () => {
			fitAddonRef.current = null;
			terminal.dispose();
			terminalRef.current = null;
		};
	}, [ghosttyReady]);

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
			safeTerminalCall(terminalRef.current, (t) =>
				t.writeln(
					`\r\n\x1b[31mFailed to open shell: ${error instanceof Error ? error.message : String(error)}\x1b[0m`,
				),
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

		const onDataDispose = terminal.onData((data: string) => {
			writeShellRef.current({ sessionId, data });
		});

		const onTitleDispose = terminal.onTitleChange((title: string) => {
			onTitleChangeRef.current?.(title);
		});

		// Guard ResizeObserver — skip while hidden to prevent WASM panics
		const resizeObserver = new ResizeObserver(() => {
			if (hiddenRef.current) return;
			safeTerminalCall(terminal, (t) => {
				fitAddon.fit();
				resizeShellRef.current({
					sessionId,
					cols: t.cols,
					rows: t.rows,
				});
			});
		});
		resizeObserver.observe(container);

		const isRenderable = () => {
			const rect = container.getBoundingClientRect();
			return rect.width > 1 && rect.height > 1;
		};

		const flushPendingWrites = () => {
			if (pendingWritesRef.current.length === 0) return;
			const buffered = pendingWritesRef.current.join("");
			pendingWritesRef.current = [];
			safeTerminalCall(terminal, (t) => t.write(buffered));
		};

		const recoverVisibility = () => {
			if (!isRenderable()) return;

			// Flush any data that arrived while hidden
			flushPendingWrites();

			safeTerminalCall(terminal, (t) => {
				const prevCols = t.cols;
				const prevRows = t.rows;

				fitAddon.fit();

				if (t.cols !== prevCols || t.rows !== prevRows) {
					resizeShellRef.current({
						sessionId,
						cols: t.cols,
						rows: t.rows,
					});
				}
			});

			// Defer scroll to next frame to let the render loop catch up
			requestAnimationFrame(() => {
				if (terminalRef.current !== terminal) return;
				safeTerminalCall(terminal, (t) => t.scrollToBottom());
			});
		};

		const handleVisibilityChange = () => {
			hiddenRef.current = document.hidden;
			if (!document.hidden) {
				// Small delay to let the canvas/surface stabilize after space switch
				setTimeout(recoverVisibility, 100);
			}
		};

		const handleWindowFocus = () => {
			if (hiddenRef.current) return;
			// Small delay for the same reason
			setTimeout(recoverVisibility, 100);
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
		if (!isActive || hiddenRef.current) {
			return;
		}

		const terminal = terminalRef.current;
		const fitAddon = fitAddonRef.current;
		const container = containerRef.current;
		if (!terminal || !fitAddon || !container) {
			return;
		}

		// Delay to let the layout settle after tab switch
		const timeoutId = setTimeout(() => {
			if (!terminalRef.current || terminalRef.current !== terminal) {
				return;
			}

			const rect = container.getBoundingClientRect();
			if (rect.width <= 1 || rect.height <= 1) {
				return;
			}

			safeTerminalCall(terminal, (t) => {
				const prevCols = t.cols;
				const prevRows = t.rows;
				fitAddon.fit();
				t.focus();

				if (
					sessionId &&
					(t.cols !== prevCols || t.rows !== prevRows)
				) {
					resizeShellRef.current({
						sessionId,
						cols: t.cols,
						rows: t.rows,
					});
				}

				t.scrollToBottom();
			});
		}, 50);

		return () => clearTimeout(timeoutId);
	}, [isActive, sessionId]);

	return (
		<div className="flex h-full w-full flex-col">
			<div className="flex items-center gap-2 border-b border-border px-3 h-10 shrink-0">
				<span className="text-xs text-muted-foreground">
					{!ghosttyReady
						? "Loading Ghostty..."
						: status === "open"
							? "SSH Shell (Ghostty)"
							: status === "opening" || status === "idle"
								? "Opening shell..."
								: "Disconnected"}
				</span>
				{cwd && (
					<span className="text-xs text-muted-foreground/60 truncate max-w-80">
						{cwd}
					</span>
				)}
				<span className="text-[10px] text-emerald-500/70 font-mono">
					ghostty-web
				</span>
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
							safeTerminalCall(terminalRef.current, (t) =>
								t.writeln(
									`\r\n\x1b[31mFailed to reopen shell: ${error instanceof Error ? error.message : String(error)}\x1b[0m`,
								),
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
