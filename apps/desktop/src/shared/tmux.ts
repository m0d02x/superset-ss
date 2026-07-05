/**
 * Hyperset-managed tmux sessions run on a private socket namespace
 * (`tmux -L hyperset`) with our own config file, so we never collide
 * with the user's own tmux server, sessions, or ~/.tmux.conf.
 *
 * User-created sessions (attach dropdown) stay on the default socket.
 */
export const HYPERSET_TMUX_SOCKET = "hyperset";
export const HYPERSET_TMUX_CONF = "~/.config/hyperset/tmux.conf";
export const HYPERSET_SESSION_PREFIX = "ss-";

/** tmux invocation for Hyperset-managed sessions (private socket). */
export const HYPERSET_TMUX = `tmux -L ${HYPERSET_TMUX_SOCKET}`;

/** Is this session name managed by Hyperset (vs a user's own tmux session)? */
export function isHypersetSession(name: string): boolean {
	return name.startsWith(HYPERSET_SESSION_PREFIX);
}

/**
 * Config written to the remote host on connect. Loaded via `-f` when the
 * hyperset tmux server starts, so behavior doesn't depend on the user's
 * ~/.tmux.conf or ~/.bashrc.
 */
export const HYPERSET_TMUX_CONF_CONTENT = `# Managed by Hyperset — do not edit (rewritten on every connect)
set -g status off
set -g escape-time 0
set -g set-clipboard on
set -g allow-passthrough on
set -g mouse on
set -g history-limit 50000
set -g default-terminal "xterm-256color"
`;
