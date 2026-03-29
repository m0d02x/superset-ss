import { Button } from "@superset/ui/button";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { debounce } from "lodash";
import { useEffect, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { RESIZE_DEBOUNCE_MS } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/config";
import { loadRenderer } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/helpers";
import { WriteBatcher } from "renderer/screens/main/components/WorkspaceView/ContentView/TabsContent/Terminal/write-batcher";

interface SSHTerminalProps {
	serverId: string;
	cwd?: string;
}

export function SSHTerminal({ serverId, cwd }: SSHTerminalProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);
	const initialCwdRef = useRef(cwd);
	const [status, setStatus] = useState<"connecting" | "open" | "closed">(
		"connecting",
	);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const terminalRef = useRef<XTerm | null>(null);

	const batcherRef = useRef(new WriteBatcher());

	const openShell = electronTrpc.servers.openShell.useMutation();
	const writeShell = electronTrpc.servers.writeShell.useMutation();
	const resizeShell = electronTrpc.servers.resizeShell.useMutation();
	const closeShell = electronTrpc.servers.closeShell.useMutation();

	const openShellRef = useRef(openShell.mutate);
	const writeShellRef = useRef(writeShell.mutate);
	const resizeShellRef = useRef(resizeShell.mutate);
	const closeShellRef = useRef(closeShell.mutate);

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
					setStatus("closed");
				}
			},
		},
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const fitAddon = new FitAddon();
		const terminal = new XTerm({
			cursorBlink: true,
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
		terminal.open(container);
		fitAddon.fit();
		terminal.focus();

		// Load GPU renderer after open to avoid race with xterm internals
		let rendererDispose: (() => void) | null = null;
		const rendererRafId = requestAnimationFrame(() => {
			const renderer = loadRenderer(terminal);
			rendererDispose = renderer.dispose;
		});

		// Attach write batcher
		batcherRef.current.attach(terminal);

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

					// Wire resize with debounce to prevent layout thrashing
					const debouncedResize = debounce(() => {
						fitAddon.fit();
						resizeShellRef.current({
							sessionId: sid,
							cols: terminal.cols,
							rows: terminal.rows,
						});
					}, RESIZE_DEBOUNCE_MS);
					const resizeObserver = new ResizeObserver(debouncedResize);
					resizeObserver.observe(container);

					// Cleanup on unmount stored in ref
					cleanupRef.current = () => {
						onDataDispose.dispose();
						debouncedResize.cancel();
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
			cancelAnimationFrame(rendererRafId);
			rendererDispose?.();
			batcherRef.current.dispose();
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
