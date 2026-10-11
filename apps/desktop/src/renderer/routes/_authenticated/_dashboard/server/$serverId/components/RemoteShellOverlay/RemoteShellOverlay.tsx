import { Button } from "@superset/ui/button";
import { Spinner } from "@superset/ui/spinner";
import { RotateCw, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRemoteSessionsStore } from "renderer/stores/remote-sessions";

interface RemoteShellOverlayProps {
	sessionKey: string;
	/** Only the visible terminal grabs focus for the Reconnect button. */
	isActive: boolean;
}

/**
 * Covers a remote terminal while its shell is down and offers Reconnect,
 * which reattaches the same tmux session (running programs survive).
 * Renders nothing while the shell is open or still opening.
 */
export function RemoteShellOverlay({
	sessionKey,
	isActive,
}: RemoteShellOverlayProps) {
	const entry = useRemoteSessionsStore(
		(state) => state.sessions[sessionKey] ?? null,
	);
	const reconnectSessionByKey = useRemoteSessionsStore(
		(state) => state.reconnectSessionByKey,
	);
	const [isReconnecting, setIsReconnecting] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	const isDown = entry?.status === "error";

	useEffect(() => {
		if (isDown && isActive) buttonRef.current?.focus();
	}, [isDown, isActive]);

	if (!isDown && !isReconnecting) return null;

	const reason = failure ?? entry?.errorMessage ?? null;

	const reconnect = () => {
		setFailure(null);
		setIsReconnecting(true);
		reconnectSessionByKey(sessionKey)
			.catch((error: unknown) => {
				setFailure(error instanceof Error ? error.message : String(error));
			})
			.finally(() => setIsReconnecting(false));
	};

	return (
		<div className="absolute inset-0 z-10 flex items-center justify-center bg-[#14100f]/80 backdrop-blur-[1px]">
			<div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
				<Unplug className="size-5 text-muted-foreground" />
				<div className="space-y-1">
					<p className="text-sm text-foreground">Shell disconnected</p>
					<p className="text-xs text-muted-foreground">
						Reconnecting reattaches the same tmux session, so running programs
						are kept.
					</p>
					{reason && (
						<p className="break-words font-mono text-[11px] text-destructive">
							{reason}
						</p>
					)}
				</div>
				<Button
					ref={buttonRef}
					size="sm"
					variant="outline"
					onClick={reconnect}
					disabled={isReconnecting}
				>
					{isReconnecting ? (
						<Spinner className="size-3.5" />
					) : (
						<RotateCw className="size-3.5" />
					)}
					Reconnect
				</Button>
			</div>
		</div>
	);
}
