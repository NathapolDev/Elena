/**
 * Guard suite: the two guarantees `src/main/ipc/bus.ts` documents in its header.
 *
 *  - NFR-18: every privileged call verifies its sender.
 *  - Contract rule: handlers return a typed Result; a thrown error is converted,
 *    never propagated across the boundary.
 *
 * A failure here means a guarantee was broken, not that the test is stale.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { broadcast, ok, registerCommand, trustWebContents } from '../src/main/ipc/bus'
import { createWebContents, ipcMain, webContents } from './stubs/electron'
import type { FakeWebContents } from './stubs/electron'

const payloadSchema = z.object({ id: z.string().min(1) })

/** `registerCommand` types its channel against CommandName; reuse a real one. */
const CHANNEL = 'workspace:get'

function invokeRegistered(sender: FakeWebContents, payload: unknown): Promise<unknown> {
  const handler = ipcMain.handlers.get(CHANNEL)
  if (!handler) throw new Error('handler was not registered')
  return Promise.resolve(handler({ sender }, payload))
}

beforeEach(() => {
  ipcMain.reset()
  webContents.reset()
})

describe('sender trust', () => {
  it('rejects an untrusted sender without running the handler', async () => {
    let ran = false
    registerCommand(CHANNEL, payloadSchema, () => {
      ran = true
      return ok({} as never)
    })

    const result = await invokeRegistered(createWebContents(99), { id: 'a' })

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    expect(ran).toBe(false)
  })

  it('accepts a trusted sender', async () => {
    registerCommand(CHANNEL, payloadSchema, (payload) => ok(payload as never))

    const sender = createWebContents(1)
    trustWebContents(sender as never)

    expect(await invokeRegistered(sender, { id: 'a' })).toEqual({ ok: true, data: { id: 'a' } })
  })

  it('drops trust when the contents are destroyed', async () => {
    registerCommand(CHANNEL, payloadSchema, (payload) => ok(payload as never))

    const sender = createWebContents(2)
    trustWebContents(sender as never)
    sender.emitDestroyed()

    expect(await invokeRegistered(sender, { id: 'a' })).toMatchObject({ ok: false })
  })
})

describe('payload validation', () => {
  it('rejects a payload that fails the schema without running the handler', async () => {
    let ran = false
    registerCommand(CHANNEL, payloadSchema, () => {
      ran = true
      return ok({} as never)
    })

    const sender = createWebContents(3)
    trustWebContents(sender as never)

    const result = await invokeRegistered(sender, { id: '' })

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    expect(ran).toBe(false)
  })
})

describe('error conversion', () => {
  it('converts a thrown error into INTERNAL without leaking its message', async () => {
    const secret = 'C:\\Users\\someone\\.ssh\\id_rsa is unreadable'
    registerCommand(CHANNEL, payloadSchema, () => {
      throw new Error(secret)
    })

    const sender = createWebContents(4)
    trustWebContents(sender as never)

    const result = (await invokeRegistered(sender, { id: 'a' })) as {
      ok: false
      error: { code: string; message: string; action?: string }
    }

    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('INTERNAL')
    expect(result.error.action).toBe('retry')
    // Raw errors never cross the boundary.
    expect(result.error.message).not.toContain(secret)
  })

  it('rejects an async handler failure the same way', async () => {
    registerCommand(CHANNEL, payloadSchema, async () => {
      await Promise.resolve()
      throw new Error('async boom')
    })

    const sender = createWebContents(5)
    trustWebContents(sender as never)

    expect(await invokeRegistered(sender, { id: 'a' })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' }
    })
  })
})

describe('broadcast', () => {
  it('sends only to trusted, live contents', () => {
    const trusted = createWebContents(10)
    const untrusted = createWebContents(11)
    const destroyed = createWebContents(12)

    trustWebContents(trusted as never)
    trustWebContents(destroyed as never)
    destroyed.destroyed = true

    webContents.all = [trusted, untrusted, destroyed]
    broadcast('theme:changed', { resolvedTheme: 'dark' })

    expect(trusted.sent).toEqual([{ channel: 'theme:changed', payload: { resolvedTheme: 'dark' } }])
    expect(untrusted.sent).toEqual([])
    expect(destroyed.sent).toEqual([])
  })
})
