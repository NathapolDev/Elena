# AGENTS.md

Rules for any AI agent or human working in this repository. Claude Code reads this through `CLAUDE.md`;
Codex CLI and Cursor read this file directly. **This is the single source of truth — do not duplicate these
rules into another file.**

## Project

Elena — a local-only Windows 11 x64 Electron desktop app that runs and supervises multiple shell / CLI-agent
sessions (Claude Code, Codex CLI, plain shells) in persisted tabs and split panes. React 19 renderer, `node-pty` for
real PTYs, and `electron-vite` build. Packaged Windows builds use the network only for stable GitHub Release updates.

## Commands

```powershell
npm ci
npm run dev            # electron-vite dev with HMR renderer
npm run lint           # eslint (flat config)
npm run typecheck      # both projects: tsconfig.node.json + tsconfig.web.json
npm test               # vitest run (tests/**/*.test.ts)
npm run build          # typecheck + electron-vite build -> out/
npm run test:e2e       # playwright + Electron; requires a prior `npm run build`
npm run build:win      # build + electron-builder NSIS installer -> release/
npm run test:coverage  # diagnostic only; there is no threshold and CI does not run it
```

Single test / focused runs:

```powershell
npx vitest run tests/layout.test.ts
npx vitest run -t "leaves no orphan process behind"
npx playwright test -g "opens a shell"
```

E2E against the packaged app (part of the release gate in `RELEASE.md`):

```powershell
$env:ELENA_E2E_EXECUTABLE = "$PWD\release\win-unpacked\Elena.exe"
npm run test:e2e
```

CI (`.github/workflows/ci.yml`, `windows-latest`) runs lint → test → build → e2e → `build:win` in that order; keep all
five green.

## Architecture

Three processes, one contract. `src/shared/` is the only code imported by all of them.

**`src/shared/ipc.ts` is the contract.** Adding a feature that crosses the process boundary means editing four places
in lockstep, and skipping any one of them fails at compile time or at runtime validation:

1. `Commands` / `Events` type in `src/shared/ipc.ts`
2. the channel name in the `COMMAND_CHANNELS` / `EVENT_CHANNELS` arrays (the preload refuses anything not listed)
3. a Zod payload schema in `requestSchemas` (`src/shared/schemas.ts`)
4. a handler in `src/main/ipc/register.ts`

Steps 1–3 are compile-time enforced; step 4 is enforced by `tests/ipc-contract.test.ts`. The
`add-ipc-command` skill walks the ritual — use it rather than doing it from memory.

**Main (`src/main/`)** owns every privileged effect. `ipc/bus.ts` wraps `ipcMain.handle`: it rejects untrusted senders,
Zod-validates the payload, and converts thrown errors into a typed `Result<T>` — raw errors never cross the boundary,
so handlers return `ok(...)` / `fail(code, message, action)` and never throw at the renderer. `ipc/register.ts` is the
single place renderer intent becomes filesystem or process effects.

**`PtyManager` (`src/main/pty/PtyManager.ts`)** is the sole owner of child processes and deliberately Electron-free so
`tests/pty.test.ts` can drive real PTYs without a window. Key invariants: `create` is idempotent per terminal id (panes
remount on split/zoom/StrictMode); output is batched on a 16 ms flush with a 4 MB backpressure cap; `terminate` sends
`\x03` then force-kills after 2 s; a stale `onExit` from a restarted id is dropped; `disposeAll()` runs on `before-quit`
and on renderer navigation so no child ever outlives the app.

**Windows (`src/main/windows.ts`)** owns every `BrowserWindow`: one main window plus a map of *detached*
windows, each rendering a single terminal pulled out of the main layout. Detaching moves UI only — `PtyManager`
is app-wide and keyed by terminal id, so the child process never notices. Detached state is in-memory in main
and mirrored to renderers through `window:detached-changed`; it is deliberately not persisted, so a relaunch
always starts with every terminal in the main window. A detached window gets the identical
`BROWSER_WINDOW_WEB_PREFERENCES` and must be passed to `trustWebContents`, or every IPC call from it is
rejected. Its role arrives as query parameters on the loaded URL (`role`, `workspaceId`, `terminalId`), which
`App.tsx` reads once at module scope. Note `broadcast` reaches *all* trusted windows, so each window filters
`terminal:data` down to what it actually renders.

**Shell integration (`src/main/shell/`)** — Explorer's *Open in Elena* verb. `--open-folder <path>` is a
contract written down in **three** places that must agree: `build/installer.nsh` (install time),
`explorerContextMenu.ts` (the Settings toggle and the post-update refresh), and `openFolderArgs.ts` (both the
cold start and the `second-instance` handler, since Explorer relaunches the exe rather than talking to the
running app). Renaming the flag or the `ElenaOpenFolder` key means changing all three;
`tests/explorerContextMenu.test.ts` is what catches a partial rename. Opening a folder resolves to a workspace
and nothing more — no session is started, per the restored-session rule below.

**Preload (`src/preload/index.ts`)** exposes exactly `invoke`, `subscribe`, `platform` on `window.elena`. No
generic `send`/`on`. Sandboxed, so it is built as CJS (`index.cjs`) — see the comment in `electron.vite.config.ts`.

**Persistence (`src/main/store/`)** — `workspaces.json`, `settings.json`, `presets.json` under Electron `userData`.
All writes go through `atomicJson.ts` (temp file + rename; a failed write leaves the last good file intact). Reads are
Zod-validated; an invalid file is renamed to `*.corrupt-<ts>.bak` and the store falls back to defaults rather than
refusing to start. Workspace writes are debounced 400 ms, flushed synchronously on quit. `WORKSPACE_SCHEMA_VERSION` is
2; bump it plus `migrateWorkspaceFile` when the persisted shape changes.

**Renderer (`src/renderer/src/`)** — one Zustand store (`state/store.ts`) holds persisted workspace state and ephemeral
runtime state (`sessions`, `unread`) side by side; only the former round-trips to disk. `lib/api.ts` unwraps `Result<T>`
into a value or an `ApiError`, so components never branch on `{ ok }`.

Two renderer patterns matter more than the component tree:

- **`lib/terminalRegistry.ts`** owns xterm instances *outside* React. Each terminal owns a detached DOM node that
  `TerminalPane` adopts on mount and hands back on unmount, so splitting, zooming, tab switches and StrictMode
  double-mounts never destroy the scrollback. Only `closeTerminal` calls `releaseTerminal`. xterm cannot read CSS
  variables, so the full `ITheme` (including all 16 ANSI slots) is resolved from tokens and repainted in place by
  `applyThemeToAll()`.
- **`lib/terminalBus.ts`** is a single `terminal:data` listener fanning out to panes, with a backlog for output that
  arrives before a pane mounts. Never subscribe to `terminal:data` per pane.

**Layout (`src/shared/layout.ts`)** is a pure recursive tree (`terminal` | `split` | `tabs`) with no DOM or Electron
imports, unit-tested in `tests/layout.test.ts`. The "Spatial Agent Grid" (`buildSpatialGrid`) paginates >4 terminals
into balanced pages using the existing `tabs` node — it adds no schema. `pruneLayout` runs on every load and update so
a layout can never reference a missing terminal.

## Conventions that are load-bearing

- **Restored sessions are configuration, not processes.** A relaunched terminal shows *Not started* until the user
  starts it; `RuntimeSession` is never persisted. Do not add auto-restart. Detached-window placement follows the
  same rule and is never written to disk.
- **Detaching does not edit the layout.** The leaf stays in the tree and renders `DetachedPanePlaceholder`, so
  the persisted workspace is untouched and reattaching is exact. Removing the leaf instead would race the
  `pruneLayout` that `workspace:update` runs on every patch.
- **No shell string composition.** Spawn is always executable + argv array. `security/paths.ts` resolves the executable
  itself (PATH + PATHEXT) so a missing binary raises `EXECUTABLE_NOT_FOUND` instead of an opaque spawn failure.
- **Env is an allowlist of names only.** Presets store variable *names*; values are read from the live OS environment
  at spawn time and never written to disk. `buildChildEnv` adds a fixed base set on top.
- **Nothing outside the workspace project root.** `validateDirectory(path, mustBeInside)` gates cwd choices; deleting
  a workspace touches app configuration only, never files under `projectRoot`.
- **Logging is metadata only** (`src/main/logger.ts`). Terminal I/O, keystrokes and env values must never be logged;
  the logger sanitizes strings, redacts token-shaped values and sensitive keys, and size-caps fields. If a new log call
  could carry a PTY chunk, don't add it.
- **Renderer security posture is fixed**: sandbox on, context isolation on, Node integration off, strict CSP in
  packaged builds, navigation/new-window/webview blocked. Don't relax these to make something work.
- **No hard-coded colors in components.** Everything comes from `styles/tokens.css`; theme switching is a single
  `data-theme` flip on `<html>` — no remount, no buffer loss.
- Path aliases: `@shared/*` (all three processes) and `@renderer/*` (renderer only). Configured separately in
  `electron.vite.config.ts`, both tsconfigs, and `vitest.config.ts` — add new aliases to all of them.
- Comments in this codebase cite requirement ids (`FR-03`, `NFR-08`, …) from a spec that is not committed. Treat them
  as rationale markers; preserve them when editing nearby code, and don't invent new ids.

### Traps that cost real debugging time

Each of these is a failure mode that has no obvious symptom. Where a guard exists it is named; where none exists,
the rule is the only thing standing between you and the bug.

1. **A missing `EVENT_CHANNELS` entry used to fail silently.** The preload's `subscribe` returns a no-op unsubscribe:
   no error, no log, no toast — the event simply never arrives. `src/shared/ipc.ts` now carries an exhaustiveness
   assertion so this is a `tsc` error. Do not "simplify" `CONTRACT_COMPLETE` or re-add a type annotation to the
   channel arrays: the annotation is what defeats `as const` and reopens the hole.
2. **Always pass `requestSchemas[channel]` for the *same* channel.** `registerCommand`'s schema parameter is typed
   `z.ZodType<unknown>` and the parsed result is cast, so handing it another command's schema typechecks cleanly and
   then validates the wrong shape at runtime. `tests/ipc-contract.test.ts` scans for the mismatch.
3. **A missing handler surfaces as a generic toast.** `ipcMain` rejects with a raw `Error`, not an `ApiError`, so
   `describeError` falls through to "Something went wrong". Never diagnose a missing handler from the UI message.
4. **Never bump a `*_SCHEMA_VERSION` in the same edit that changes the persisted shape without writing a transform.**
   `migrateWorkspaceFile` for `< CURRENT` spreads the object and bumps the number — bumping alone permanently stamps
   old data as new. `tests/persistence-migration.test.ts` pins the versions as a tripwire.
5. **Adding an `AppErrorCode` requires a `titleForCode` case.** `src/renderer/src/lib/api.ts` ends with a `never`
   assertion instead of a `default:`, so this is a compile error. Do not re-add the `default:` branch.
6. **`releaseTerminal` is called from exactly one place** — `closeTerminal` in `state/store.ts`. Adding a `dispose()`
   in `TerminalPane`'s unmount destroys scrollback on every split, zoom, tab switch and StrictMode double-mount.
   `tests/renderer-invariants.test.ts` counts the call sites.
7. **Exactly one `subscribe('terminal:data', …)` call site exists**, in `App.tsx`, feeding `lib/terminalBus.ts`.
   Subscribing per pane is a fan-out bug, not a style preference. Also counted by `tests/renderer-invariants.test.ts`.
8. **`app:error` is for failures with no command to answer.** It exists because a shell "Open in Elena" click
   has no renderer call to return a `Result` to, and a silent no-op there is undiagnosable. Anything reachable
   from a command should still fail through that command's `Result`, not this channel. `tests/ipc-contract.test.ts`
   asserts every declared event is genuinely broadcast, so a second dead channel cannot appear unnoticed.
9. **`workspace:update` patches are wholesale, so every window must stay subscribed to `workspace:changed`.**
   `renameTerminal` and `closeTerminal` send the entire `terminals` array built from that window's own copy.
   With a second window open, a stale copy silently deletes terminals it never knew about — the config
   vanishes from `workspaces.json`, `pruneLayout` drops its leaf, and its PTY keeps running with nothing
   owning it. `App.tsx` answers the event by re-reading the list. Do not remove that subscription, and do not
   assume the renderer is the only writer.
10. **`readTerminalTheme` must resolve every slot from tokens.** xterm cannot read CSS variables, so a missing ANSI
   slot silently falls back to xterm's own dark-tuned palette and only shows up as a wrong colour in one theme.
   `tests/theme-tokens.test.ts` asserts light/dark parity and that every slot the registry reads is declared in both.

### Multiplicative paths

Before adding work to a path that runs per byte, per event or per frame, write down its **frequency x cardinality**
and multiply. The cardinality is never 1: panes, tabs, windows and terminals all scale independently, and the two
worst performance bugs this codebase has had were both a correct-looking line on a path that ran 60 times a second
times the number of open windows.

- **Per-PTY-chunk** (`PtyManager.enqueue` / `flush`, `terminalBus.dispatchTerminalData`, `logger.write`) — x every
  running session. Nothing here may do a blocking syscall, and no single send may be unbounded.
- **Per-frame** (`updateRatio` and anything else driven by pointermove) — x every window that answers the resulting
  event. Send at most once per animation frame, and let local state carry the drag.
- **Per-event broadcast** (`broadcast` in `ipc/bus.ts`) — x every trusted window. If only one window can use the
  payload, use `sendTo` instead; a renderer-side filter still paid for the clone.
- **`workspace:changed`** — every window answers it with a full `workspace:list`, so it is x windows x workspaces
  x terminals. Emitting it at pointer rate is what P1 was.

`tests/hot-path.test.ts` holds the specific regressions this rule already prevented. `npm run test:perf` is the
measurement; run it before and after touching any of the paths above.

### Dependencies

- **No new runtime dependency without justification in the commit body.** There are three
  (`node-pty`, `electron-updater`, `@phosphor-icons/react`) and that is a deliberate security property for an app
  that spawns processes. Prefer the Node standard library.
- **`zod`, `zustand` and `@xterm/*` are in `devDependencies` on purpose.** electron-vite bundles them, and the
  packaged-app E2E proves it end to end. Moving them to `dependencies` would bloat the asar for no benefit. Do not
  "fix" this.

## Testing

- `tests/` (vitest, node env) covers layout tree ops, path/env validation, schemas, persistence and real PTY lifecycle.
  Electron is stubbed via `tests/stubs/electron.ts` — main-process modules should stay testable through that stub.
- **Do not add vitest `setupFiles` or global auto-mocks.** The thin Electron stub is the pressure that keeps
  main-process code Electron-light; hiding it behind global mocks removes that pressure.
- Several suites are *guard tests*: they encode a contract rather than a behaviour, and a failure means the contract
  was broken, not that the test is stale. Fix the code, not the assertion:
  `ipc-contract`, `ipc-preload`, `ipc-bus`, `security-posture`, `theme-tokens`, `renderer-invariants`,
  `persistence-migration`, `logger-no-pty`, `agent-docs`, `explorerContextMenu`.
- `e2e/smoke.spec.ts` is one serial user journey (create workspace → real PTY → split → theme switch → restart → quit
  without orphans) against a temp `--user-data-dir`. Electron automation is experimental, so E2E covers user flows only;
  layout, PTY and persistence guarantees are proven by vitest.
- `design-qa.md` records the visual QA pass for the Spatial Agent Grid against a reference image; update it if you
  change that layout's composition. The `design-qa` skill drives the pass.
