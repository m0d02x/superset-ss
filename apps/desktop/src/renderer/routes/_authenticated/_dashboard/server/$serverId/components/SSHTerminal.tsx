import { Button } from "@superset/ui/button";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface SSHTerminalProps {
	serverId: string;
	terminalId: string;
	cwd?: string;
	onCwdChange?: (cwd: string) => void;
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
	onCwdChange,
}: SSHTerminalProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);
	const initialCwdRef = useRef(cwd);
	const cwdBufferRef = useRef("");
	const [status, setStatus] = useState<"connecting" | "open" | "closed">(
		"connecting",
	);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const terminalRef = useRef<XTerm | null>(null);

	const openShell = electronTrpc.servers.openShell.useMutation();
	const writeShell = electronTrpc.servers.writeShell.useMutation();
	const resizeShell = electronTrpc.servers.resizeShell.useMutation();
	const closeShell = electronTrpc.servers.closeShell.useMutation();
	const openShellRef = useRef(openShell.mutate);
	const writeShellRef = useRef(writeShell.mutate);
	const resizeShellRef = useRef(resizeShell.mutate);
	const closeShellRef = useRef(closeShell.mutate);
	const onCwdChangeRef = useRef(onCwdChange);

	useEffect(() => {
		openShellRef.current = openShell.mutate;
	}, [openShell.mutate]);

	useEffect(() => {
		writeShellRef.current = writeShell.mutate;
	}, [writeShell.mutate]);

	useEffect(() => {
		resizeShellRef.current = resizeShell.mutate;
	}, [resizeShell.mutate]);

	useEffect(() => {
		closeShellRef.current = closeShell.mutate;
	}, [closeShell.mutate]);

	useEffect(() => {
		onCwdChangeRef.current = onCwdChange;
	}, [onCwdChange]);

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
					setStatus("closed");
				}
			},
		},
	);

	// Open shell and setup xterm
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const fitAddon = new FitAddon();
		const terminal = new XTerm({
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

		setStatus("connecting");

		// Open PTY shell on server
		openShellRef.current(
			{
				serverId,
				cols: terminal.cols,
				rows: terminal.rows,
				cwd: initialCwdRef.current,
			},
			{
				onSuccess: ({ sessionId: sid }) => {
					setSessionId(sid);
					setStatus("open");

					// Wire terminal input → shell
					const onDataDispose = terminal.onData((data) => {
						writeShellRef.current({ sessionId: sid, data });
					});

					// Wire resize
					const resizeObserver = new ResizeObserver(() => {
						fitAddon.fit();
						resizeShellRef.current({
							sessionId: sid,
							cols: terminal.cols,
							rows: terminal.rows,
						});
					});
					resizeObserver.observe(container);

					// Cleanup on unmount stored in ref
					cleanupRef.current = () => {
						onDataDispose.dispose();
						resizeObserver.disconnect();
						closeShellRef.current({ sessionId: sid });
					};
				},
				onError: (err) => {
					terminal.writeln(
						`\r\n\x1b[31mFailed to open shell: ${err.message}\x1b[0m`,
					);
					setStatus("closed");
				},
			},
		);

		return () => {
			cleanupRef.current?.();
			terminal.dispose();
			terminalRef.current = null;
		};
	}, [serverId]);

	return (
		<div className="flex h-full w-full flex-col">
			<div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
				<span className="text-xs text-muted-foreground">
					{status === "open"
						? "SSH Shell"
						: status === "connecting"
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
						setSessionId(null);
						setStatus("connecting");
						// Force re-mount by clearing container
						if (containerRef.current) {
							containerRef.current.innerHTML = "";
						}
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
