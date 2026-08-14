# Security policy

## Supported versions

The latest stable release only. Elena is Windows 11 x64.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/NathapolDev/Elena/security/advisories/new).
Please do not open a public issue for an unfixed vulnerability.

## Scope

Elena runs locally and reaches the network only to check stable GitHub Releases for updates. Reports about
the following are in scope:

- **Process spawn** — anything that turns a workspace, preset or setting into command execution the user did
  not intend. Spawning is always executable + argv, never a composed shell string, and the executable is
  resolved through PATH/PATHEXT rather than a shell.
- **Path containment** — a way to make a terminal's working directory, or a workspace operation, escape the
  configured project root. Directory validation resolves real paths on both sides before comparing, so
  symlink escapes are in scope.
- **The IPC boundary** — reaching an `ipcMain` handler from an untrusted sender or an unlisted channel, or
  getting a handler to act on a payload that fails its schema.
- **Renderer isolation** — anything that defeats the sandbox, context isolation, the packaged CSP, or the
  navigation / window-open / webview blocks.
- **Environment and secrets** — a way to get environment variable *values*, terminal output, or keystrokes
  written to disk. Presets store variable names only; values are read at spawn time and never persisted, and
  the log file is metadata only.
- **The update channel** — anything that would let a build other than a signed stable GitHub Release be
  installed.

## Out of scope

- The behaviour of the shells and CLI agents the user chooses to run. Elena supervises them; it does not
  sandbox them, and a session has the user's own privileges by design.
- Anything requiring an attacker who already has code execution as the user on the machine.
- The installer being unsigned. This is a known limitation recorded in `RELEASE.md`, not a vulnerability.
