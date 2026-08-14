/**
 * Guard suite: the IPC contract stays in sync across all four places.
 *
 * A failure here means the contract was broken, not that the test is stale.
 * Fix the code, not the assertion.
 *
 * Steps 1 and 3 (`Commands`/`Events` and `requestSchemas`) are already compile
 * errors; step 2 became one when the channel arrays lost their type annotation.
 * Step 4 — the handler in `register.ts` — has no compile-time enforcement at
 * all, and neither does the pairing of a channel with *its own* schema. That is
 * what this file covers.
 */
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, beforeEach } from 'vitest'
import { COMMAND_CHANNELS, CONTRACT_COMPLETE, EVENT_CHANNELS } from '@shared/ipc'
import { requestSchemas } from '@shared/schemas'
import { ipcMain } from './stubs/electron'

const SRC_MAIN = join(process.cwd(), 'src/main')
const REGISTER_PATH = join(SRC_MAIN, 'ipc/register.ts')

/**
 * Events declared on the contract that nothing in `src/main` broadcasts.
 *
 * `app:error` is subscribed to in `App.tsx` but never sent — a dead channel.
 * It is listed here so it stays a reviewed exception instead of silently
 * looking like a working feature. Remove the entry when a broadcast is wired,
 * or delete the channel.
 */
const KNOWN_UNBROADCAST: readonly string[] = ['app:error']

async function readMainSources(dir: string = SRC_MAIN): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  const parts = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return readMainSources(full)
      return entry.name.endsWith('.ts') ? readFileSync(full, 'utf8') : ''
    })
  )
  return parts.join('\n')
}

describe('IPC contract', () => {
  it('keeps the exhaustiveness assertion in place', () => {
    // Deleting CONTRACT_COMPLETE from ipc.ts would silently remove the only
    // compile-time proof that every command and event is in its allowlist.
    expect(CONTRACT_COMPLETE).toEqual([true, true])
  })

  it('has a request schema for exactly the allowlisted commands', () => {
    expect(Object.keys(requestSchemas).sort()).toEqual([...COMMAND_CHANNELS].sort())
  })

  it('lists no channel twice', () => {
    expect(new Set(COMMAND_CHANNELS).size).toBe(COMMAND_CHANNELS.length)
    expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length)
  })

  it('pairs every registerCommand call with its own schema', () => {
    const source = readFileSync(REGISTER_PATH, 'utf8')
    const calls = [...source.matchAll(/registerCommand\(\s*'([^']+)'\s*,\s*requestSchemas\['([^']+)'\]/g)]

    expect(calls.length).toBeGreaterThan(0)
    const mismatched = calls
      .filter(([, channel, schema]) => channel !== schema)
      .map(([, channel, schema]) => `${channel} validated with requestSchemas['${schema}']`)

    // registerCommand's schema parameter is z.ZodType<unknown> and the result is
    // cast, so a mismatch typechecks cleanly and validates the wrong shape.
    expect(mismatched).toEqual([])
  })

  it('passes a schema through requestSchemas in every registerCommand call', () => {
    const source = readFileSync(REGISTER_PATH, 'utf8')
    const total = [...source.matchAll(/registerCommand\(/g)].length
    const viaSchemas = [...source.matchAll(/registerCommand\(\s*'[^']+'\s*,\s*requestSchemas\[/g)].length

    // An inline z.object() here would bypass the shared contract entirely.
    expect(viaSchemas).toBe(total)
  })

  it('broadcasts only declared events', async () => {
    const source = await readMainSources()
    const broadcast = new Set([...source.matchAll(/broadcast\(\s*'([^']+)'/g)].map(([, channel]) => channel))

    for (const channel of broadcast) {
      expect(EVENT_CHANNELS, `broadcast('${channel}') is not in EVENT_CHANNELS`).toContain(channel)
    }
  })

  it('either broadcasts every declared event or records it as a known exception', async () => {
    const source = await readMainSources()
    const broadcast = new Set([...source.matchAll(/broadcast\(\s*'([^']+)'/g)].map(([, channel]) => channel))

    const dead = EVENT_CHANNELS.filter(
      (channel) => !broadcast.has(channel) && !KNOWN_UNBROADCAST.includes(channel)
    )
    expect(dead, 'declared events that nothing in src/main sends').toEqual([])

    // And the reverse: an exception that started working should be un-listed.
    const revived = KNOWN_UNBROADCAST.filter((channel) => broadcast.has(channel))
    expect(revived, 'KNOWN_UNBROADCAST entries that are now broadcast — remove them').toEqual([])
  })
})

describe('IPC handler registration', () => {
  beforeEach(() => {
    ipcMain.reset()
  })

  it('registers exactly one handler per allowlisted command', async () => {
    // Imported lazily so the stub reset above applies, and because register.ts
    // pulls in the whole main-process dependency graph.
    const { registerIpcHandlers } = await import('../src/main/ipc/register')

    const noop = (): never => {
      throw new Error('handlers are not invoked by this suite')
    }
    const stub = new Proxy({}, { get: () => noop })

    // The stub throws on a duplicate channel, so a double registration fails here.
    registerIpcHandlers({
      workspaces: stub,
      settings: stub,
      presets: stub,
      pty: stub,
      updates: stub,
      getWindow: () => null
    } as unknown as Parameters<typeof registerIpcHandlers>[0])

    expect([...ipcMain.handlers.keys()].sort()).toEqual([...COMMAND_CHANNELS].sort())
  })
})
