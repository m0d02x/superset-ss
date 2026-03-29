import { Button } from "@superset/ui/button";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { electronTrpc } from "renderer/lib/electron-trpc";

interface SSHTerminalProps {
	serverId: string;
	cwd?: string;
}

export function SSHTerminal({ serverId, cwd }: SSHTerminalProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [status, setStatus] = useState<"connecting" | "open" | "closed">(
		"connecting",
	);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const terminalRef = useRef<XTerm | null>(null);

	const openShell = electronTrpc.servers.openShell.useMutation();
	const writeShell = electronTrpc.servers.writeShell.useMutation();
	const resizeShell = electronTrpc.servers.resizeShell.useMutation();
	const closeShell = electronTrpc.servers.closeShell.useMutation();

	// Subscribe to shell output
	electronTrpc.servers.onShellData.useSubscription(
		{ sessionId: sessionId ?? "" },
		{
			enabled: !!sessionId,
			onData: (msg) => {
				if (msg.type === "data") {
					terminalRef.current?.write(msg.data);
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
		openShell.mutate(
			{
				serverId,
				cols: terminal.cols,
				rows: terminal.rows,
				cwd,
			},
			{
				onSuccess: ({ sessionId: sid }) => {
					setSessionId(sid);
					setStatus("open");

					// Wire terminal input → shell
					const onDataDispose = terminal.onData((data) => {
						writeShell.mutate({ sessionId: sid, data });
					});

					// Wire resize
					const resizeObserver = new ResizeObserver(() => {
						fitAddon.fit();
						resizeShell.mutate({
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
						closeShell.mutate({ sessionId: sid });
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
	}, [
		serverId,
		cwd,
		closeShell.mutate, // Open PTY shell on server
		openShell.mutate,
		resizeShell.mutate,
		writeShell.mutate,
	]);

	const cleanupRef = useRef<(() => void) | null>(null);

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
