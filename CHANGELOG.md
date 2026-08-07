# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
