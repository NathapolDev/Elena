# CLAUDE.md

Elena's rules live in `AGENTS.md` so Claude Code, Codex CLI and Cursor obey the same contract.
**Do not duplicate rules here — edit `AGENTS.md`.**

@AGENTS.md

## Claude Code specifics

**Subagents** (`.claude/agents/`) — run one after any non-trivial change in its area, before calling the work done:

- `elena-main-reviewer` — `src/main/`, `src/preload/`, `src/shared/`
- `elena-renderer-reviewer` — `src/renderer/`

**Skills** (`.claude/skills/`):

- `add-ipc-command` — anything crossing the process boundary. Use it instead of doing the ritual from memory.
- `release-gate` — cutting a release, bumping the version, preparing a `v*` tag.
- `design-qa` — after changing `buildSpatialGrid`, pane chrome or terminal typography.

**Hooks** (`.claude/settings.json`) run the same commands CI runs, just earlier:

- every edited `.ts`/`.tsx` is linted immediately
- editing the IPC contract runs the three IPC guard suites
- the end of a turn is gated on `typecheck` + `vitest`

A blocked `Stop` means the tree is red. Read the output and fix it — do not retry, and do not weaken a guard test to
get past it.

**Permissions** — `.claude/settings.json` is committed and applies to every clone.
`.claude/settings.local.json` is machine-local and gitignored; never edit it to widen permissions, propose a change
to `settings.json` instead.
