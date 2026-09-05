# PR title

feat: add changed-file review with split diffs and line totals

## Description

Adds a Changes dialog for reviewing staged, unstaged and untracked files while terminal sessions keep running.
Users can switch between unified and side-by-side views, see added/deleted totals on the Changes button and open
existing files in VS Code. The preview hides Git file headers and keeps hunk locations and newline annotations.

Refresh reloads the selected diff. Repeated plus/minus content retains its colors and line numbers. Large previews
stop at 2,000 display lines per section, and file validation yields between batches to keep main responsive.
Git commands disable external diff and text conversion helpers; file opening validates workspace containment.

## Validation

- Local checks passed: lint, both TypeScript projects, production build, 310 unit/integration tests,
  33 Electron E2E tests and both performance fixtures.

- Unit and integration coverage: Git status and totals, workspace scope, binary/large untracked files, diff
  alignment, file headers, newline annotations and the display limit.
- Electron E2E: refresh, mode switching, totals, hidden headers, large previews and terminal session continuity.
- Local Git and ten-PTY performance fixtures; measurements and limits in `docs/releases/view-diff.md`.
- No new runtime dependencies or persistence migrations. Installer and packaged-app gates remain for release.
