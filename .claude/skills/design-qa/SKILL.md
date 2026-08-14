---
name: design-qa
description: Run the Spatial Agent Grid visual QA pass against the reference image and record the result in design-qa.md. Use after changing buildSpatialGrid, layout composition, pane chrome, the inspector, or terminal typography.
---

# Spatial Agent Grid visual QA

`design-qa.md` records this pass. AGENTS.md carries the *rule* ("update design-qa.md if you change that
layout's composition"); this is the procedure, which is otherwise re-derived from scratch every time.

## 1. Read the existing record first

Open `design-qa.md`. It names the comparison target, the exact viewport, the state to reproduce, and the
five required fidelity surfaces. It also carries a comparison history — you are appending an iteration, not
starting over.

Note: the reference image path in that file is outside the repo, and `spatial-grid-qa.png` is gitignored.
If either is missing, say so and stop rather than inventing a comparison.

## 2. Reproduce the state

The pass is only valid at the recorded viewport (**1488 × 1058 CSS px**) in the recorded state:

- dark theme
- one active project workspace
- **four running PowerShell sessions in a 2×2 spatial grid** — this is the whole point; fewer than four does
  not paginate and exercises none of `buildSpatialGrid`
- the second session focused
- the inspector expanded

```powershell
npm run build
npm run dev
```

Create the workspace, start four sessions, focus the second, expand the inspector, then capture at the exact
viewport to `spatial-grid-qa.png`.

To exercise pagination rather than just the 2×2 case, start a fifth and sixth session — `buildSpatialGrid`
pages >4 terminals into balanced pages using the existing `tabs` node.

## 3. Compare

Open the reference and the capture together at 1:1. Walk the five surfaces `design-qa.md` lists, in order:
typography, spacing and layout rhythm, colours and visual tokens, image/asset fidelity, copy and content.

Classify each mismatch P0/P1/P2 as the existing history does. Functional differences in fixture data (real
PowerShell prompts and temp paths instead of the illustrative transcript) are **expected**, not drift — the
existing record says so explicitly.

## 4. Record the iteration

Append to the `Comparison history` section in `design-qa.md`:

```md
### Iteration N — passed | blocked

- [P1] <what differs, where, and what it should be>
```

Update `Findings` to match the current state, and update the `Required fidelity surfaces` prose only if a
surface's assessment actually changed. Do not rewrite history entries.

## 5. If anything changed structurally

A change to the grid's composition may also need `tests/layout.test.ts` updating — `buildSpatialGrid` is a
pure function over the layout tree and is unit tested there, not by this pass.
