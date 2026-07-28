# Elena release checklist

## Candidate gate

- [ ] Version and release notes are final.
- [ ] `npm ci`, lint, typecheck, unit/integration tests, and Electron E2E pass on Windows 11 x64.
- [ ] `npm audit --audit-level=critical` reports no critical vulnerabilities.
- [ ] Ten concurrent noisy PTYs complete without an event-loop stall of 200 ms or more and all child processes terminate.
- [ ] `npm run build:win` produces the installer and `win-unpacked` app.
- [ ] The full Electron E2E suite passes with `ELENA_E2E_EXECUTABLE` set to the packaged executable.
- [ ] Packaged CSP, Node isolation, typed IPC sender checks, navigation blocking, path containment, and log redaction are verified.
- [ ] Installer is scanned, signed when a certificate is available, and smoke-tested on a clean Windows 11 x64 account.
- [ ] GitHub CI passes from a committed baseline before publishing.

## Known limitations

- Windows 11 x64 only for MVP; Windows 10, macOS, and Linux are unverified.
- Restoring a workspace restores terminal configuration and tab/split layout, not the original processes or buffers.
- The installer is unsigned until a code-signing certificate is configured, so Windows may show a reputation warning.
- Agent CLIs must already be installed and discoverable from the application environment.
- No cloud sync, SSH, remote terminal, collaboration, telemetry, or automatic agent orchestration.

## Rollback plan

1. Stop distribution of the affected installer and retain its version, checksum, and failure report.
2. Re-publish the last verified installer; do not overwrite versioned artifacts.
3. Users can uninstall the affected build and reinstall the previous version. Project folders are not modified by uninstall or workspace deletion.
4. Before downgrading across a workspace schema change, back up the app user-data directory. Schema v2 reads v1 files, but older builds do not understand v2 tab layouts.
5. Fix forward on a new patch version, rerun every candidate gate, and document whether user-data migration is required.
