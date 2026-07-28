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

## Publishing

Merging to `main` builds and tests the app but does **not** publish anything — the
`release` job in `.github/workflows/ci.yml` is gated on `refs/tags/v*`, so a push to
`main` leaves the installer as an expiring workflow artifact only. Pushing an
annotated `vX.Y.Z` tag is what creates the GitHub Release.

1. Confirm the candidate gate above passed on the commit you are about to tag.
2. Tag that commit and push the tag:

   ```powershell
   git checkout main
   git pull origin main
   git tag -a v0.1.0 -m "Elena v0.1.0"
   git push origin v0.1.0
   ```

The tag must be `v` plus the exact `version` in `package.json`; CI fails at the
"Verify release tag matches package version" step otherwise. The `release` job runs
only after `windows` passes all five stages (lint → test → build → e2e → build:win),
then attaches `Elena-<version>-x64.exe` to a GitHub Release with generated notes.

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
