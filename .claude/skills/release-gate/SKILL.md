---
name: release-gate
description: Drive Elena's release checklist — version bump, CHANGELOG entry, full local gate, packaged-app E2E, and tag. Use when cutting a release, bumping the version, or preparing a v* tag.
---

# Driving a release

**Read `RELEASE.md` first and follow it.** It is the checklist; this file does not repeat it. What is here is
the setup that is easy to get wrong and the two things that bite every time.

## Before you start

1. Read `RELEASE.md` end to end. The candidate gate is not optional and not summarisable.
2. Confirm the working tree is clean and you are on the commit you intend to release. `RELEASE.md` is
   explicit that the release is a *specific SHA*, not "whatever `main` points at later".

## The two things that bite

**1. The tag must be `v` + the exact `version` in `package.json`.** CI fails at the "Verify release tag
matches package version" step otherwise, and by then the tag already exists and has to be deleted from the
remote. Check both before tagging:

```powershell
node -p "require('./package.json').version"
git tag --list "v*" | Select-Object -Last 5
```

**2. The packaged-app E2E needs the executable path exported first**, or it silently tests the dev build:

```powershell
npm run build:win
$env:ELENA_E2E_EXECUTABLE = "$PWD\release\win-unpacked\Elena.exe"
npm run test:e2e
```

## Local gate — the same five steps CI runs, in order

```powershell
npm ci
npm run lint
npm test
npm run build
npm run test:e2e
npm run build:win
```

All must be green locally before tagging. `build:win` also runs
`scripts/verify-update-artifacts.mjs`, which is what proves `latest.yml` and the blockmap shipped.

Two environment notes for this machine:

- **Switch the keyboard layout to English before `npm run test:e2e`.** On a Thai layout `Ctrl+C` types `แ`,
  so the smoke test's interrupt never fires and the test fails for a reason that has nothing to do with the
  code.
- **Close VS Code before `npm run build:win`.** It locks `release/win-unpacked.tmp` and electron-builder dies
  with `EBUSY`, which looks like a stale artifact but is not.

## CHANGELOG

`CHANGELOG.md` is Keep a Changelog format. Add the new version above the previous one with the release date
in `YYYY-MM-DD`, and group entries under `### Added` / `### Changed` / `### Fixed` / `### Removed`. Write for
a user of the app, not a reader of the diff.

## Tagging

Follow the `Publishing` section of `RELEASE.md` exactly — it pins the tag to the verified SHA rather than to
`HEAD`. Do not push a tag until the whole local gate is green, because the tag is what creates the public
GitHub Release.

## After publishing

`RELEASE.md` has an auto-update acceptance test that needs two real releases. If this is the first release of
a pair, note in the release notes that the acceptance test is pending, and run it when the next patch ships.
