# Elena release checklist

## Candidate gate

- [ ] Version and release notes are final.
- [ ] `npm ci`, lint, typecheck, unit/integration tests, and Electron E2E pass on Windows 11 x64.
- [ ] `npm audit --audit-level=critical` reports no critical vulnerabilities.
- [ ] `npm run test:perf` passes: ten concurrent noisy PTYs, no event-loop stall of 200 ms or more, no child process
      left behind. Record the printed numbers in the release notes and compare them against the previous release.
- [ ] `npm run build:win` produces the installer and `win-unpacked` app.
- [ ] The package contains `Elena-<version>-x64.exe`, its `.exe.blockmap`, and `latest.yml`.
- [ ] The full Electron E2E suite passes with `ELENA_E2E_EXECUTABLE` set to the packaged executable.
- [ ] Packaged CSP, Node isolation, typed IPC sender checks, navigation blocking, path containment, and log redaction are verified.
- [ ] The bundled font ships complete: `app.asar` contains the three `0xProtoNerdFontMono-*.ttf` faces and
      `out/renderer/OFL-0xProto.txt`, and a terminal in the packaged app renders a Nerd Font glyph. SIL OFL 1.1
      requires the licence to travel with the font, so a missing `OFL-0xProto.txt` blocks the release.
- [ ] Installer is scanned, signed when a certificate is available, and smoke-tested on a clean Windows 11 x64 account.
- [ ] GitHub CI passes from a committed baseline before publishing.

## Publishing

Merging to `main` builds and tests the app but does **not** publish anything — the
`release` job in `.github/workflows/ci.yml` is gated on `refs/tags/v*`, so a push to
`main` leaves the installer as an expiring workflow artifact only. Pushing an
annotated `vX.Y.Z` tag is what creates the GitHub Release.

1. Run the candidate gate above against a specific commit on `main` and record its
   full SHA. That commit — not whatever `main` points at later — is the release.
2. Tag that exact commit and push the tag:

   ```powershell
   git fetch origin main
   git log --oneline -1 <verified-sha>   # confirm this is the gated commit
   git tag -a v0.3.0 <verified-sha> -m "Elena v0.3.0"
   git push origin v0.3.0
   ```

   Naming the SHA keeps the tag pinned to the validated commit even if `origin/main`
   advanced in the meantime; never tag a post-pull `HEAD`.

The tag must be `v` plus the exact `version` in `package.json`; CI fails at the
"Verify release tag matches package version" step otherwise. The `release` job runs
only after `windows` passes all five stages (lint → test → build → e2e → build:win),
then attaches `Elena-<version>-x64.exe`, its blockmap, and `latest.yml` to a stable GitHub Release with generated notes.

## Auto-update acceptance test

This end-to-end check requires two real stable releases and cannot be completed against 0.3.0 alone.

1. Install the published 0.3.0 installer, launch Elena, open About Elena, and confirm it reports 0.3.0 as current.
2. Publish the next patch release (for example 0.3.1) with all three updater artifacts attached.
3. Relaunch 0.3.0 or select **Check for updates**. Confirm the UI moves through checking and downloading, shows a
   percentage, and ends at **Restart & Install** without creating a second download when checked again.
4. Disconnect the network during a check, confirm About shows an error and **Retry**, reconnect, and retry.
5. Start terminals with visible unsaved commands, select **Restart & Install**, and confirm the warning names the
   terminal shutdown. Cancel once to prove no process closes, then confirm it.
6. Confirm every terminal process exits, the installer runs silently, Elena reopens as the new version, and the
   persisted workspace layout remains available without auto-starting terminal processes.

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
4. Before downgrading across a schema change, back up the app user-data directory. Version 0.2.0 migrates settings
   from v1 to v2; version 0.1.0 does not preserve the new terminal typography fields. Older builds also do not
   understand v2 workspace tab layouts.
5. Fix forward on a new patch version, rerun every candidate gate, and document whether user-data migration is required.
