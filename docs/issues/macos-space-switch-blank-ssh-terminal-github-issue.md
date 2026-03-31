# Bug: Remote SSH terminal goes blank after macOS Space switch

## Status

Resolved

## Summary

In the packaged macOS desktop app, switching to another Space and then back could break remote SSH terminals.

Two user-visible failure modes were observed:

1. returning to the terminal started a new SSH session instead of preserving the existing one
2. after session preservation was fixed, the terminal could still appear visually blank even though typing still worked and the shell was still alive

This reproduced in the installed app at `/Applications/Hyperset.app`, but not in the development Electron app.

## Reproduction

1. Open a remote server workspace terminal in the desktop app
2. Switch to another macOS Space
3. Switch back to the desktop app
4. Observe either:
   - a fresh SSH session starts, or
   - the terminal is blank but still responds to input

## Root Cause

This ended up being a chain of issues rather than one bug:

- remote SSH session lifetime was initially tied to the React component mount/unmount lifecycle
- detach was incorrectly treated as terminal teardown, so Space-driven view detaches still closed sessions
- xterm view state was not restored after remount, so a live shell could reappear with a blank visible buffer
- packaged macOS runtime behavior differed from dev: the working dev Electron process disabled `MacWebContentsOcclusion`, while the packaged app did not
- stale installed bundle contents could hide fixes until the app was deleted and reinstalled cleanly

## Fix

### Session lifetime

- moved remote SSH session ownership into a renderer-side store
- detach now preserves the SSH session
- explicit reconnect / tab close / page teardown / remote close destroy the session

### Terminal view restoration

- added renderer-side remote terminal snapshot/restore support
- added visibility/focus repaint recovery
- added WebGL texture atlas clearing for the workspace SSH terminal before repaint

### Production macOS runtime

- updated packaged macOS app startup to disable `MacWebContentsOcclusion`
- strengthened window-level repaint recovery on `restore`, `show`, and `focus`

### Install resolution

- fully deleted `/Applications/Hyperset.app`
- rebuilt the desktop app
- reinstalled a fresh bundle into `/Applications`

That final clean reinstall was required to guarantee the installed app actually matched the rebuilt runtime.

## Key Files

- `apps/desktop/src/renderer/stores/remote-sessions/store.ts`
- `apps/desktop/src/renderer/stores/remote-sessions/view-state.ts`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/server/$serverId/components/SSHTerminal.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/server/$serverId/workspace/$workspaceId/components/SSHTerminal.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/server/$serverId/workspace/$workspaceId/page.tsx`
- `apps/desktop/src/main/windows/main.ts`
- `apps/desktop/src/lib/electron-app/factories/app/setup.ts`

## Verification

- diagnostics clean on modified files
- typecheck passed
- desktop build passed
- remote session and snapshot tests passed
- development Electron reproduction worked
- production app worked after clean reinstall

## Installed App Verified

- path: `/Applications/Hyperset.app`
- version: `1.4.5`

## Reference

Full incident writeup:

- `docs/issues/macos-space-switch-blank-ssh-terminal.md`
