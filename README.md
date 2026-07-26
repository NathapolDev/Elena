# AI Workspaces

Local-only Windows desktop workspace for running and supervising multiple shell or CLI-agent sessions in persisted tabs and split panes.

## Development

Requires Node.js 22 or newer on Windows 11 x64.

```powershell
npm ci
npm run dev
```

Validation commands:

```powershell
npm run lint
npm test
npm run build
npm run test:e2e
npm run build:win
$env:AIWS_E2E_EXECUTABLE = "$PWD\release\win-unpacked\AI Workspaces.exe"
npm run test:e2e
```

## Architecture and security

- Electron main owns PTYs, persistence, filesystem validation, theme integration, and allowlisted IPC handlers.
- The sandboxed React renderer has context isolation enabled, Node integration disabled, and only the typed preload API.
- Workspace files use versioned JSON, atomic writes, corruption backup, and v1-to-v2 migration for persisted tabs.
- Terminal input/output and environment values are not logged; sensitive metadata fields and token-like strings are redacted.
- Navigation, new windows, webviews, paths, and privileged IPC senders are restricted in the main process.

## Troubleshooting

- If a CLI preset cannot start, install its executable or edit the preset in Settings and ensure it is on `PATH`.
- If a working directory is rejected, choose the workspace root or one of its descendants.
- Restored terminals show **Not started** by design; select **Start** to create a new process.
- Application logs contain event metadata only and live under the Electron user-data directory in `logs`.

See [RELEASE.md](./RELEASE.md) for the release gate, known limitations, and rollback procedure.
