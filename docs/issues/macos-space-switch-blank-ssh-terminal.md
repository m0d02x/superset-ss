# Issue: Remote SSH Terminal Goes Blank After macOS Space Switch

**Status:** Fixed  
**Severity:** High  
**Platform:** macOS desktop app  
**Components:**
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/server/$serverId/components/SSHTerminal.tsx`
- `apps/desktop/src/renderer/routes/_authenticated/_dashboard/server/$serverId/workspace/$workspaceId/components/SSHTerminal.tsx`
- `apps/desktop/src/renderer/stores/remote-sessions/store.ts`
- `apps/desktop/src/lib/electron-app/factories/app/setup.ts`
- `apps/desktop/src/main/windows/main.ts`

---

## Symptom

In the installed macOS desktop app, switching to another Space and then back could break remote SSH terminals in two stages:

1. **Initial failure mode**: returning to the terminal triggered a brand-new SSH session instead of preserving the existing one.
2. **Later failure mode**: after session preservation was fixed, the terminal could still return visually blank even though typing still worked and the remote shell continued responding.

This reproduced in the packaged `/Applications/Hyperset.app`, but **not** in the development Electron app.

## Root Cause

This was not a single bug. It was a chain of lifecycle problems:

### 1. SSH session lifetime was tied to React component lifetime

The remote server `SSHTerminal` components opened a shell in a mount effect and closed it on unmount. A Space switch or route/view remount therefore behaved like a brand-new terminal and reopened SSH.

### 2. Detach was incorrectly treated as terminal teardown

Even after moving remote session ownership out of the component and into a renderer-side store, the first store version still closed sessions when a terminal view detached. That meant Space switching still indirectly killed the session because the terminal view unmounted.

The correct model was:

- **detach** → keep SSH session alive
- **explicit reconnect / tab close / page teardown / remote-side close** → destroy SSH session

### 3. The terminal view did not restore visible state after remount

Once the SSH session survived, the next issue was purely visual: the xterm instance was recreated from scratch, so the user could reattach to a live shell but lose the visible prompt and scrollback.

That required a renderer-side snapshot/restore path using serialized terminal content.

### 4. Production-only macOS occlusion/compositor behavior still blanked the terminal

The strongest production-only clue was that the bug reproduced in the installed app but **not** in the dev Electron app.

Comparing the running processes showed the working dev Electron process was launched with:

```text
--disable-features=MacWebContentsOcclusion
```

The packaged app was not. That matters because the bug was specifically triggered by macOS Space switching / occlusion.

This was the most important production-only mismatch.

### 5. A stale installed app bundle could hide new fixes

After multiple in-place copy installs, the final resolution also required a **true clean reinstall**:

1. delete `/Applications/Hyperset.app`
2. rebuild the app
3. copy the fresh bundle back into `/Applications`

That removed any chance that stale packaged contents were masking the latest runtime fixes.

## Fix

### A. Move remote SSH session lifetime out of the React component

Added a renderer-side session store:

- `apps/desktop/src/renderer/stores/remote-sessions/store.ts`

This store now owns:

- open / reconnect / destroy semantics
- attached view count
- detached session preservation
- explicit teardown on close paths

### B. Preserve detached SSH sessions

Changed remote session policy so a view unmount does **not** close the SSH session.

Only these actions tear it down:

- explicit reconnect
- terminal tab close
- page teardown
- remote-side close

### C. Restore terminal view state on remount

Added a renderer-side snapshot cache:

- `apps/desktop/src/renderer/stores/remote-sessions/view-state.ts`

This uses serialized xterm output so remounting a terminal view restores the last visible prompt/output instead of showing a blank screen.

### D. Add repaint recovery on visibility/focus return

Both remote SSH terminal components now run visibility recovery on:

- `document.visibilitychange`
- `window.focus`

Recovery includes:

- `fitAddon.fit()`
- `terminal.refresh(...)`
- resize sync back to the remote PTY if geometry changed

### E. Clear stale WebGL glyph state for workspace SSH terminals

The workspace SSH terminal uses the shared WebGL renderer helper. It now keeps a renderer handle and calls:

```ts
rendererRef.current?.clearTextureAtlas?.()
```

before repaint recovery so stale WebGL atlas state cannot leave the terminal visually blank after occlusion.

### F. Match the working dev runtime in the packaged app

Added the following macOS packaged-app startup flag in:

- `apps/desktop/src/lib/electron-app/factories/app/setup.ts`

```ts
app.commandLine.appendSwitch("disable-features", "MacWebContentsOcclusion");
```

The app already disabled backgrounding occluded windows; the missing piece was disabling macOS web contents occlusion itself in production.

### G. Strengthen window-level repaint recovery

In `apps/desktop/src/main/windows/main.ts`, macOS window events now use `forceRepaint(window)` on:

- `restore`
- `show`
- `focus`

instead of relying only on plain invalidation.

## Why the Dev App Worked While Production Failed

The development Electron process exposed the key difference:

- dev renderer process included `--disable-features=MacWebContentsOcclusion`
- packaged production app did not

That meant the dev app already avoided the macOS occlusion path that was blanking the installed app’s terminal after Space switches.

So while the earlier session/view fixes were necessary, the production-only compositor/occlusion setting was the final runtime mismatch that explained why dev worked and the installed app did not.

## Files Changed

| File | Change |
|:-----|:-------|
| `apps/desktop/src/renderer/stores/remote-sessions/store.ts` | Store-owned remote SSH session lifetime; detach no longer closes sessions |
| `apps/desktop/src/renderer/stores/remote-sessions/view-state.ts` | Terminal snapshot/restore cache for remote SSH views |
| `apps/desktop/src/renderer/stores/remote-sessions/view-state.test.ts` | Snapshot cache tests |
| `apps/desktop/src/renderer/stores/remote-sessions/store.test.ts` | Detached-session and teardown regression coverage |
| `apps/desktop/src/renderer/routes/_authenticated/_dashboard/server/$serverId/components/SSHTerminal.tsx` | Session attach/detach rendering, snapshot restore, repaint recovery |
| `apps/desktop/src/renderer/routes/_authenticated/_dashboard/server/$serverId/workspace/$workspaceId/components/SSHTerminal.tsx` | Same as above, plus WebGL atlas recovery |
| `apps/desktop/src/renderer/routes/_authenticated/_dashboard/server/$serverId/workspace/$workspaceId/page.tsx` | Explicit remote session destruction only on real terminal/page teardown |
| `apps/desktop/src/main/windows/main.ts` | Stronger macOS repaint handling on restore/show/focus |
| `apps/desktop/src/lib/electron-app/factories/app/setup.ts` | Disable `MacWebContentsOcclusion` in the packaged macOS app |

## Verification

Verified during the fix process:

- LSP diagnostics on modified files: clean
- typecheck: passed
- desktop build: passed
- remote session / snapshot tests: passed
- dev Electron app reproduction: **worked correctly**
- packaged app required a clean reinstall to guarantee the new runtime flags and bundle contents were actually in use

Final install verification:

- clean delete of `/Applications/Hyperset.app`
- rebuild
- fresh copy back to `/Applications/Hyperset.app`
- installed bundle version confirmed as `1.4.5`

## Operational Lesson

For Electron/macOS rendering bugs that reproduce only in the installed app and not in development:

1. compare the actual Electron process flags between dev and production
2. treat Space-switch / occlusion bugs as compositor/runtime issues, not only React/xterm issues
3. after runtime-level fixes, do a **true clean reinstall** of the app bundle before trusting the result
