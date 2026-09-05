# View Diff — unreleased

Review uncommitted changes inside Elena, switch between unified and side-by-side views, and open files in VS Code.
The Changes button displays added/deleted line totals across staged, unstaged and untracked text files.
Totals refresh on workspace changes, window focus and closing the dialog; they are not continuously polled.

Git file headers are hidden in both views. Refresh reloads the selected diff, and repeated plus/minus characters
are treated as code content. No persistence migration or new runtime dependency is required.

## Limits

- At most 1,000 changed files, 2 MiB of patch output per selected file and 2,000 display lines per section.
- Untracked line counting reads at most 2 MiB per file and 16 MiB per summary. Binary files contribute no text
  lines. `≥` marks incomplete counts; omitted preview content has a visible notice.
- The viewer is read-only. It does not stage files, resolve conflicts or edit content.

## Local performance — 2026-09-05

Windows 11 x64, Node 22.18.0. Single local runs; these are not CI measurements or a statistical benchmark.
Run `npm run test:perf` to reproduce the fixtures. Performance suites run sequentially to avoid overlap.

| Git fixture | Before batching / early parse stop | After |
| --- | ---: | ---: |
| Summary, 1,000 untracked two-line files | 2,180.1 ms | 2,086.2 ms |
| Selected file diff in the same repository | 580.4 ms | 621.8 ms |
| Prepare 1.8 MB / 600,000-line patch for preview | 183.9 ms | 2.4 ms |
| Maximum event-loop delay across the fixture | 551.6 ms | 57.7 ms |

The main improvement is responsiveness, not total Git latency. Path checks yield every eight files, and the
renderer stops parsing once its display limit is reached. The preparation measurement is a Node execution of
the shared parser, not browser rendering time. Electron E2E separately checks the 2,000-line display bound.

The pre-change ten-PTY release smoke processed 4.8 MB in 3,307 sends over eight seconds: largest send 4 KB,
event-loop p99 11.4 ms, max 12.2 ms, RSS growth 141.8 MB, no running children after disposal. The 0.6.0 local
baseline recorded p99 16.2 ms, max 17.3 ms and RSS growth 140.6 MB. Different machine load and output volume
prevent treating these differences as a speedup.

Final sequential performance gate passed both fixtures. Ten PTYs produced 5.7 MB in 3,322 sends; largest send
4 KB, p99 11.5 ms, max 12.9 ms, RSS growth 140.3 MB, no running children after disposal. The Git fixture
measured summary 2,226.7 ms, selected diff 568.1 ms, preview preparation 2.1 ms and max event-loop delay
80.3 ms. Both event-loop maxima are below the 200 ms gate.

## Release status

PR review follow-up disables Git promisor lazy fetching, combines staged deletions with untracked replacements
at the same path, and preserves symlink paths for diff and line counting. The local follow-up suite passed
312 tests with one file-symlink test skipped because Windows denied symlink creation; the test runs when that
privilege is available. CI remains the final gate for the follow-up commit.

Local validation passed lint, both TypeScript projects, production build and 310 unit/integration tests.
The full 33-test Electron E2E suite passed, including hidden headers and a 20,000-line file bounded to
2,000 display lines. The final large-preview flow took 1,209 ms including refresh, Git and browser assertions;
it is an end-to-end observation, not a frame-time measurement.

Prepared for PR review, not a published release. Keep the changelog under Unreleased until the release version
and date are selected. The final Windows installer build, packaged-app E2E, audit, signing/clean-account checks
and GitHub CI remain release gates in `RELEASE.md`.
