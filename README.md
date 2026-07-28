<p align="center">
  <img src="./src/renderer/public/elena.png" width="160" alt="Elena app icon">
</p>

<h1 align="center">Elena</h1>

<p align="center">
  A local-first desktop command center for shell and CLI-agent sessions.
</p>

<p align="center">
  <a href="https://github.com/NathapolDev/Elena/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/NathapolDev/Elena/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Windows 11 x64" src="https://img.shields.io/badge/platform-Windows%2011%20x64-0078D4?logo=windows11&logoColor=white">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white">
  <img alt="Electron 43" src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white">
</p>

Elena is a local-only Windows desktop workspace for running shells and CLI agents side by side. It preserves workspace configuration, terminal tabs, and split layouts between launches while keeping project files and processes under your control.

## Highlights

- **Multiple sessions, one workspace** — supervise shells, Codex CLI, Claude Code, and other local CLI tools together.
- **Flexible layouts** — arrange terminals in tabs, horizontal or vertical splits, or a paginated 2×2 spatial grid.
- **Agent presets** — define reusable executables, arguments, working directories, and allowlisted environment variables.
- **Persistent setup** — restore workspaces, terminal configuration, names, and layouts after relaunching Elena.
- **Focused controls** — rename, search, zoom, restart, stop, and close sessions without leaving the workspace.
- **Live appearance** — switch between light, dark, and system themes without remounting active terminals.
- **Keyboard-first navigation** — create, switch, rename, and manage sessions through global shortcuts and the command palette.
- **Local security boundary** — sandboxed rendering, typed IPC, path validation, and redacted logs keep privileged operations in the Electron main process.

## Getting Started

### Requirements

- Windows 11 x64
- Node.js 22 or newer
- Any shell or agent CLI you want to run, installed and available on `PATH`

### Run from source

```powershell
git clone https://github.com/NathapolDev/Elena.git
cd Elena
npm ci
npm run dev
```

## Typical Workflow

1. Create a workspace and bind it to an existing project folder.
2. Open a detected shell, an agent preset, or a custom executable.
3. Add sessions as tabs or splits, then use **Layout: 2×2** when you need a wider operational view.
4. Close Elena when finished. Workspace and layout configuration return on the next launch; processes do not restart automatically.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Elena in development mode. |
| `npm run typecheck` | Type-check the Electron and renderer projects. |
| `npm run lint` | Run ESLint across the repository. |
| `npm test` | Run unit and integration tests with Vitest. |
| `npm run test:e2e` | Run the Electron end-to-end suite. |
| `npm run build` | Type-check and create the production Electron bundles. |
| `npm run build:win` | Build the Windows x64 application and NSIS installer. |

### Validate a packaged build

```powershell
npm run build:win
$env:ELENA_E2E_EXECUTABLE = "$PWD\release\win-unpacked\Elena.exe"
npm run test:e2e
```

Build artifacts are written to `release/`. See the [release checklist](./RELEASE.md) for the complete candidate gate and rollback procedure.

## Architecture and Security

- **Electron main process** owns PTYs, persistence, theme integration, filesystem validation, and privileged IPC handlers.
- **Typed preload bridge** exposes the allowlisted `window.elena` API while context isolation and the renderer sandbox remain enabled.
- **React renderer** owns presentation and adopts long-lived xterm instances without owning operating-system processes.
- **Atomic persistence** writes versioned, Zod-validated workspace, settings, and preset data under Electron `userData`.
- **Process isolation** starts commands as an executable plus argument array; shell command strings are not composed.
- **Restricted navigation** blocks unapproved navigation, new windows, webviews, and privileged IPC senders.
- **Privacy-conscious logging** excludes terminal input, output, and environment values while redacting token-like metadata.

## Known Limitations

- Windows 11 x64 is the only verified platform.
- Restored sessions contain configuration and layout, not the original processes or terminal buffers.
- Agent CLIs must be installed separately and discoverable from the application environment.
- Installers are unsigned until a code-signing certificate is configured, so Windows may display a reputation warning.
- Elena does not provide cloud sync, SSH, remote terminals, collaboration, telemetry, or automatic agent orchestration.

## Troubleshooting

- **A preset cannot start:** install its executable or update the preset in **Settings**, then confirm the command is on `PATH`.
- **A working directory is rejected:** select the workspace root or one of its descendants.
- **A restored terminal says _Not started_:** select **Start** to create a new process; restored processes are never launched automatically.
- **You need diagnostic logs:** event metadata is stored under the Electron user-data directory in `logs`; terminal content is not logged.

## Project Links

- [Issue tracker](https://github.com/NathapolDev/Elena/issues)
- [Continuous integration](https://github.com/NathapolDev/Elena/actions/workflows/ci.yml)
- [Release checklist and rollback procedure](./RELEASE.md)
