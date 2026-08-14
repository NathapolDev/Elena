---
name: add-ipc-command
description: Add, rename or remove an IPC command or event in Elena's shared contract. Use whenever something crosses the process boundary — a new window.elena call, a Commands/Events entry, a src/main/ipc/register.ts handler, or a new broadcast.
---

# Adding to the IPC contract

Four places, in this order. Steps 1 and 3 are compile errors if you skip them; step 2 became one too, but
only because of an assertion that is easy to break. Step 4 has no compile-time enforcement at all.

Do not do this from memory — the failure modes are silent.

## 1. Declare it — `src/shared/ipc.ts`

A command goes in `Commands` with its request and response types:

```ts
'workspace:archive': { req: { id: string }; res: Workspace }
```

An event goes in `Events` with its payload only:

```ts
'workspace:archived': { workspaceId: string }
```

Use `req: void` for a payloadless command.

## 2. Allowlist the channel — same file

Add the exact string to `COMMAND_CHANNELS` or `EVENT_CHANNELS`.

⚠️ **A missing event entry used to be completely silent** — the preload's `subscribe` returns a no-op
unsubscribe, so the event simply never arrives: no error, no log, no toast. `CONTRACT_COMPLETE` at the bottom
of the file now makes it a `tsc` error. Never re-add a type annotation to these arrays (`: readonly
CommandName[]`) — the annotation widens the tuple and reopens the hole.

## 3. Validate it — `src/shared/schemas.ts`

Add a Zod schema to `requestSchemas` under the same key. Match the existing style:

```ts
'workspace:archive': z.object({ id: z.string().min(1) }),
// payloadless:
'preset:reset': z.void().or(z.undefined()),
```

Bound every string and array (`.max(...)`). The main process validates *before* touching the filesystem or
spawning anything (NFR-13).

Events have no schema — only commands carry a renderer-supplied payload.

## 4. Handle it — `src/main/ipc/register.ts`

```ts
registerCommand('workspace:archive', requestSchemas['workspace:archive'], ({ id }) => {
  const workspace = workspaces.get(id)
  return workspace ? ok(workspaces.archive(id)) : fail('NOT_FOUND', 'Workspace not found.')
})
```

- **The channel and the schema key must be the same string.** `registerCommand`'s schema parameter is
  `z.ZodType<unknown>` and the parsed result is cast, so passing another command's schema typechecks cleanly
  and then validates the wrong shape at runtime. `tests/ipc-contract.test.ts` scans for this.
- Return `ok()` / `fail(code, message, action?)`. Never throw — the bus converts a throw into an opaque
  `INTERNAL`, which is a worse error message than the one you could have written.
- For an event, call `broadcast('workspace:archived', { workspaceId })` from wherever the state actually
  changes. A declared event that nothing broadcasts fails `tests/ipc-contract.test.ts` unless it is recorded
  in that file's `KNOWN_UNBROADCAST` list.

## 5. Nothing to do in the preload

`src/preload/index.ts` and `index.d.ts` are both checked against `WorkspacesApi` in `@shared/ipc`, and the
preload reads the channel allowlists at runtime. This step exists only so nobody reintroduces the
hand-written duplicate that used to live in `index.d.ts`.

## 6. Call it from the renderer

Through `lib/api.ts`, never `window.elena.invoke` directly:

```ts
import { call, on } from '@renderer/lib/api'

const workspace = await call('workspace:archive', { id })
const unsubscribe = on('workspace:archived', ({ workspaceId }) => { /* … */ })
```

`call()` unwraps `Result<T>` into a value or throws an `ApiError`, so components never branch on `{ ok }`.
Catch with `describeError(error)` for a toast.

For `terminal:data` specifically: **do not subscribe.** There is exactly one subscription, in `App.tsx`,
feeding `lib/terminalBus.ts`.

## 7. New failure mode?

If the command can fail in a way none of the existing `AppErrorCode` values describe, add one in
`src/shared/types.ts` — and then `titleForCode` in `src/renderer/src/lib/api.ts` will fail to compile until
you add the case. That is deliberate; do not add a `default:` branch to silence it.

## 8. Verify before declaring done

```powershell
npm run typecheck
npx vitest run tests/ipc-contract.test.ts tests/ipc-preload.test.ts tests/ipc-bus.test.ts
```

These are guard suites: a failure means the contract is broken, not that a test is stale. Fix the code.
