# Elena Browser Workspace — Design QA

Verified 2026-10-15 (Asia/Bangkok). This replaces the Spatial Agent Grid reference after the user selected browser-style session tabs and Saved projects.

## Evidence and environment

- Source: `docs/images/browser-tabs-reference.png` — the approved ImageGen preview, 1536 × 1024 px.
- Main implementation: `docs/images/browser-workspace-dark.png` — 1536 × 982 px, CSS-sized capture.
- Other states: `docs/images/browser-workspace-light.png` and `docs/images/browser-workspace-saved-projects.png` — 1180 × 720 px.
- Combined full comparison: `test-results/browser-qa/comparison-full.png`; focused chrome comparison: `test-results/browser-qa/comparison-chrome.png`.
- Normalization: removed the source's 43 px native title bar. Its client area is 1536 × 981 px; the implementation is 1536 × 982 px because of Windows DPI rounding. Neither image was stretched. The comparison canvas pads the source by one pixel at the bottom.
- Captures also cover 1488 × 1059 CSS px (requested 1488 × 1058, rounded by Windows), both themes, and Saved projects. Native minimum size 1180 × 720 was checked.
- State: Elena expanded with Claude/Codex/Shell tabs, Codex selected, API Service and Docs collapsed. A real PowerShell PTY prints a fixture transcript; the screenshot does not claim a live Codex agent. Only the selected fixture session is running.
- Tooling: the project's Playwright Electron runner, with disposable profiles. The Browser plugin is not available, and a browser tab cannot exercise this native app's preload/PTY contract. Capture command: `node scripts/capture-browser-workspace.mjs`.

## Visual comparison

The source and final capture were compared together, including a separate crop of the tab strip and toolbar. Both show one grouped session-tab row, a compact context toolbar, and one full-width terminal. Sidebar, grid chrome, inspector, and permanent bottom actions are absent as requested.

- **Typography:** retained the bundled UI and terminal fonts. UI uses Elena's existing compact 13 px scale; the capture fixture uses the adjustable 16 px terminal setting. The generated mock is larger. This deliberate density choice preserves readability at minimum size and gives terminal content more room.
- **Spacing:** tabs are 46 px and toolbar 40 px. Tab titles truncate; the whole selected tab, including Close, scrolls into view. New session, bookmarks, and All tabs remain reachable when the strip overflows.
- **Colors:** existing One Half Dark tokens, restrained teal/purple/neutral group labels, neutral selected-tab surface, and semantic status colors. Equivalent group tokens are declared for Light. No component color literals were added.
- **Assets:** native Elena branding and existing Phosphor icons are reused. The approved mock contains no additional raster artwork needed by the interface.
- **Copy:** Project terminology is used in create/rename/bookmark flows. Branch names, running counts, prompts, and transcript content are runtime data; the fixture's Redesign branch differs from the mock's main branch. Saved projects is the user-approved addition after the mock.

No actionable P0/P1/P2 visual findings remain. Larger typography matching the generated mock can be considered as optional P3 polish; terminal typography remains user-adjustable.

## Fix history

1. **P1 — oversized toolbar:** the original app grid rule overrode the new three-row shell. Increasing the browser-shell selector specificity restored the intended layout. Final captures measure 46/40 px chrome and no pane header in single view.
2. **P2 — Close clipped on overflowing tabs:** scrolling the tab button omitted its sibling Close control. Scroll targeting now includes the whole tab; the New session button sits outside the scroll region. The overflow journey checks both bounds and reachability.
3. **P1 — divider missed pointer input:** terminal content covered the divider hit area. The divider now has its own stacking level. Real hit testing and mouse dragging pass; ratio updates are paced to one animation frame and do not replace the saved layout.

Post-fix evidence is the combined final comparison and the completed Electron journeys. Earlier grid screenshots are superseded by this approved design.

## Validation

| Check | Result |
| --- | --- |
| Page identity, populated app, no framework overlay | Passed |
| Capture console warnings/errors | None |
| Lint and TypeScript | Passed |
| Unit/contract tests | 327 passed; one existing symlink case skipped because Windows lacks the privilege |
| Electron E2E | 36 passed, including copy/paste, real split dragging, background output, bookmarks, overflow, relaunch, font/theme continuity, detached-window writes, and orphan cleanup |
| Windows build | NSIS installer, blockmap, and latest.yml produced and artifact-verified |
| Performance | 2 suites passed; 10 PTYs, event-loop p99 16.3 ms, max 16.7 ms, largest send 6 KB |

Baseline PTY p99 was 16.6 ms. These are main-process throughput measurements, not a renderer frame-rate claim. Noisy-session output stays bounded; unread state changes only once until acknowledged. Split resizing sends no workspace layout updates.

An earlier desktop session could not round-trip even the native Windows clipboard; the E2E preflight isolates that environment limitation. The final run supported clipboard access and passed the copy/paste test. An isolated rerun also passed the full unit suite after a transient worker exit during concurrent packaging.

The installer was built, not installed. Packaged-app E2E was not run locally because startup can refresh the user's Explorer registry integration; the shared E2E launcher supports `ELENA_E2E_EXECUTABLE` for that release gate in an isolated environment.

## Fence report

Changed: browser chrome, saved/open project preferences, session navigation and creation, temporary split views, their tests, capture tooling, and this QA evidence. Workspace schema and IPC interfaces remain compatible with existing saved projects.

Noticed, not changed: native desktop clipboard availability and Windows symlink privileges vary by execution session. No OS policy or renderer security settings were changed to bypass them.

final result: passed
