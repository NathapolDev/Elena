# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-09-01

Performance. This release adds no features on purpose: every ceiling it lifts is on a path that the next
release's features will run on top of.

### Changed

- Terminals are drawn by the GPU. xterm now renders through WebGL instead of rebuilding DOM nodes per changed
  cell, which is what the "ten busy sessions stay smooth" target runs into first. A machine with no usable GPU
  context — a remote desktop, a VM, a driver Chromium refuses — falls back to the previous renderer on its own,
  as does a terminal whose graphics context is lost while running.

  Settings has a *Draw terminals with the GPU* toggle for turning it off, which takes effect immediately and
  keeps scrollback, selection and focus. Turn it off if terminals look wrong or feel slow over Remote Desktop.
- Terminal output is delivered only to the window showing that terminal. It used to be sent to every open
  window, which then discarded what it did not draw, so three detached windows cost four times the work.
- Dragging a split divider no longer asks every window to reload every workspace on every frame. The drag
  itself is unchanged; what it sends behind the scenes is now paced to the screen's refresh rate, and other
  windows catch up a fraction of a second after the drag settles.
- Terminal font size and line height are saved when you leave the field or press Enter, rather than on every
  keystroke — each keystroke used to be its own write to disk. Terminals are also no longer repainted for
  settings changes that do not affect the theme.
- A burst of output is delivered in bounded pieces instead of one very large message, and the buffer that
  holds output for a pane that has not appeared yet is now limited by size rather than by a message count that
  bounded nothing.
- The application log no longer inspects the log file on every line it writes.

### Added

- `npm run test:perf` measures the release criterion — ten noisy terminals, event-loop delay, memory growth —
  and runs in CI before the installer is built, so a slowdown fails the build instead of being noticed later.
- `AGENTS.md` gains a *Multiplicative paths* rule, with `tests/hot-path.test.ts` holding the specific
  regressions this release fixed.

### Release measurements

`npm run test:perf`, ten noisy PTYs over an 8 s window. The criterion is no event-loop stall of 200 ms or
more. There is no 0.5.0 baseline to compare against — the measurement did not exist before this release, so
these numbers are the baseline 0.7.0 will be read against.

| | Windows 11 x64 dev machine | `windows-latest` CI runner |
| --- | --- | --- |
| Output | 5.6 MB in 3334 sends | 2.2 MB in 3241 sends |
| Largest single send | 4 KB | 2 KB |
| Event-loop p99 | 16.2 ms | 21.5 ms |
| Event-loop max | 17.3 ms | 25.4 ms |
| RSS growth | 140.6 MB | 120.0 MB |

Both runs left no child process behind. The largest send sits far under the 256 KB per-send cap, so the cap
is a ceiling this workload never reaches rather than something these numbers exercise.

## [0.5.0] - 2026-08-22

### Added

- **Open in Elena** in the Windows Explorer context menu. Right-click a folder, the empty background inside an
  open folder, or a drive, and Elena opens on it: an existing workspace for that folder is selected, and a
  folder without one gets a workspace named after it. No session starts by itself — a restored session stays
  configuration, as everywhere else. The entry is registered by the installer and removed on uninstall, and
  Settings has a *Show "Open in Elena" when right-clicking a folder* toggle for turning it off and back on.

  On Windows 11 the entry appears under *Show more options* (Shift+F10) rather than in the first context menu,
  which is where Windows places verbs from apps that are not registered as shell extensions.

## [0.4.0] - 2026-08-15

### Added

- Search workspaces from the sidebar by name or project folder. `Ctrl+Shift+F` focuses the field, `Escape`
  clears it, and the list shows how many of the total match while a query is active.
- Quick Session starts an agent without preparing a workspace first, from the empty state or the command
  palette. Sessions land in a scratch workspace called *Quick Session* on your home folder, created once and
  reused afterwards.
- Move a pane by dragging its header onto another pane. Dropping on the middle swaps the two; dropping on an
  edge re-splits along that axis. `Ctrl+Alt+Left`/`Right` swaps with the neighbouring pane from the keyboard.
- Open a terminal in its own window from the pane header, and bring it back from the placeholder it leaves
  behind. The process keeps running throughout — only the window drawing it changes — so the new window starts
  its scrollback from that moment and says so. Which terminals are detached is never written to disk: every
  relaunch starts with all of them in the main window.

### Changed

- The whole pane header is now the drag handle, marked with a grip, rather than the title alone.
- The pane header's search button is replaced by *Open in new window*; searching the scrollback moved into the
  pane's overflow menu.
- A pane too narrow to show its icon row folds the row into a single menu button and hides the working
  directory, branch, and elapsed time, so nothing overlaps and no action becomes unreachable.

### Fixed

- A narrow pane no longer draws its status badge on top of the action buttons.
- `F2` no longer opens the rename dialog while you are typing in a text field.

## [0.3.0] - 2026-07-31

### Added

- Packaged Windows builds check stable GitHub Releases on startup and on demand from About Elena, then show
  download progress and offer a confirmed silent restart-and-install flow.
- Release builds now include the NSIS installer, differential update blockmap, and `latest.yml` channel metadata.

### Changed

- The release pipeline publishes every file required by the built-in updater. Existing 0.2.0 installations still
  need one manual upgrade to 0.3.0 before future updates can install automatically.

## [0.2.0] - 2026-07-29

### Added

- Terminal typography settings can load and search font families installed on the machine, then apply the
  selected family to existing and new terminals without clearing their buffers.
- Terminal font size is configurable from 8–48 px and line height from 1.0–2.0, with a live preview and a reset
  action that restores the original 13 px and 1.2 defaults.
- 0xProto Nerd Font Mono ships inside the application and is now the default terminal font, so powerline separators
  and developer icons render on a machine that has never installed a Nerd Font and without any network access.
  Regular, bold, and italic faces are included; upstream has no bold-italic face, so that combination is synthesised.

### Changed

- The default terminal font stack leads with the bundled 0xProto Nerd Font Mono. Previously installed fallbacks
  (JetBrains Mono, Cascadia Mono, Consolas) remain behind it, and an explicitly selected family still wins.

- Terminal typography preferences persist across relaunches. Settings files migrate from schema v1 to v2 while
  preserving existing preferences and filling in the original terminal typography defaults.

## [0.1.0] - 2026-07-29

First release. Windows 11 x64 only, distributed as an unsigned NSIS installer.

### Workspaces

- Bind a workspace to an existing project folder. Deleting a workspace removes Elena's configuration only —
  nothing under the project root is touched.
- Workspace name, terminal configuration, and layout return on relaunch. Processes do not: a restored session
  shows *Not started* until you start it.
- Writes are atomic and schema-validated. A file that fails validation is moved aside as
  `*.corrupt-<timestamp>.bak` and Elena starts from defaults instead of refusing to launch.

### Sessions

- Run shells detected on the machine (PowerShell 7, Windows PowerShell, Command Prompt, Git Bash), an agent
  preset, or a custom executable with arguments.
- Built-in presets for Claude Code and Codex CLI, plus a Custom Command placeholder. A preset stores an
  executable, arguments, a default working directory, and the *names* of environment variables to pass through.
- Per-pane controls: start, stop, restart, rename, zoom, search the scrollback, select all, clear.
- Each pane header shows its working directory, git branch, session status, and elapsed time.

### Layout

- Tabs, horizontal and vertical splits with dividers resizable by pointer or arrow keys, and a 2×2 spatial grid
  that paginates into pages of up to four panes.
- Terminal buffers survive splitting, zooming, tab switches, and theme changes.

### Appearance and input

- Light, dark, and system themes. System mode follows Windows without a restart.
- Command palette (Ctrl+K) and global shortcuts for creating, switching, renaming, zooming, and closing sessions.
- Configurable scrollback (1,000–200,000 lines), confirmation before closing a running session, and a warning
  before pasting multiple lines.

### Security

- The renderer runs sandboxed with context isolation on and Node integration off. Packaged builds apply a strict
  Content Security Policy; navigation, new windows, and webviews are blocked.
- The preload bridge exposes only `invoke`, `subscribe`, and platform metadata, restricted to an allowlist of
  channels. Main-process handlers verify the sender and validate every payload before acting.
- Commands are spawned as an executable plus an argument array; no shell command string is composed. Working
  directories are resolved and must stay inside the workspace project root.
- Environment variable values are read from the live OS environment at spawn time and never written to disk.
- Logs record event metadata only. Terminal input, output, and environment values are never logged; token-shaped
  values and sensitive keys are redacted.
- Every child process is terminated when the app quits or the renderer navigates.

### Known limitations

- Windows 11 x64 is the only verified platform. Windows 10, macOS, and Linux are untested.
- The installer is unsigned until a code-signing certificate is configured, so Windows may show a reputation
  warning.
- Agent CLIs must be installed separately and discoverable on `PATH`.
- Restoring a workspace does not restore processes or terminal buffers.
- No cloud sync, SSH, remote terminals, collaboration, telemetry, or automatic agent orchestration.

See [RELEASE.md](./RELEASE.md) for the release gate and rollback procedure.
