# Implementation details
For Electron interprocess communication, ALWAYS use trpc as defined in `src/lib/trpc`
Please use alias as defined in `tsconfig.json` when possible

## Server Workspaces (Remote SSH)

The desktop app's primary workspace model is **server workspaces** — remote servers accessed via SSH with tmux-backed persistent terminal sessions. There are no local workspaces.

### Architecture
- **Servers** connect via SSH (`src/main/lib/ssh-connection-manager.ts`)
- **Spaces** are organizational groups within a server (each has a directory, color, label)
- **Terminals** are tmux sessions on the remote host, scoped per space
- Tmux session naming: `ss-${spaceId}-${terminalId}` (e.g. `ss-abc123-term-1`)
- Tab/terminal state lives in `renderer/stores/servers-state.ts` (ephemeral, restored from tmux on reconnect)

### Tmux socket isolation (`src/shared/tmux.ts`)
Hyperset-managed sessions (`ss-*`) run on a **private tmux socket** (`tmux -L hyperset`) with a managed config, fully isolated from the user's own tmux server:
- On connect, `~/.config/hyperset/tmux.conf` is (re)written to the remote host (status off, clipboard, passthrough, escape-time, mouse, etc.)
- The hyperset tmux server starts with `-f ~/.config/hyperset/tmux.conf`, so behavior never depends on the user's `~/.tmux.conf` or `~/.bashrc`
- All commands touching `ss-*` sessions (new-session, list-sessions, kill-session, socket cleanup) MUST use `HYPERSET_TMUX` from `shared/tmux`
- The "Attach" dropdown intentionally queries the **default** socket — it lists the user's own tmux sessions; attaching to one uses plain `tmux`

### Session persistence
- Tmux sessions survive app restarts — on reconnect, existing `ss-*` sessions are discovered and restored as tabs
- A stale hyperset tmux socket (from crashes) is cleaned up automatically on connect (only `/tmp/tmux-$UID/hyperset`, never the user's default socket)
- Detached sessions are NOT killed — they're reattached when the space is reopened
- Only explicit tab close (`destroySession`) kills the tmux session

## tRPC Subscriptions (trpc-electron)

**Important:** While standard tRPC recommends async generators for subscriptions, `trpc-electron` (used for Electron IPC) **only supports observables**. The library explicitly checks `isObservable(result)` and throws an error otherwise. Use the `observable` pattern:

```typescript
// CORRECT for trpc-electron - use observable pattern
import { observable } from "@trpc/server/observable";

export const createMyRouter = () => {
  return router({
    subscribe: publicProcedure.subscription(() => {
      return observable<MyEvent>((emit) => {
        const handler = (data: MyData) => {
          emit.next({ type: "my-event", data });
        };

        myEmitter.on("my-event", handler);

        return () => {
          myEmitter.off("my-event", handler);
        };
      });
    }),
  });
};

// WRONG for trpc-electron - async generators don't work with IPC transport
export const createMyRouter = () => {
  return router({
    subscribe: publicProcedure.subscription(async function* () {
      // This will NOT work - the generator never gets invoked
      while (true) {
        yield await getNextEvent();
      }
    }),
  });
};
```