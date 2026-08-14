/**
 * Guard suite: the preload bridge is the security boundary (NFR-18).
 *
 * A failure here means the boundary was widened, not that the test is stale.
 *
 * Two things are asserted that nothing else can: that the exposed surface has
 * no generic `send`/`on`, and that an off-allowlist channel is refused *before*
 * it reaches `ipcRenderer` — including the event case, which otherwise fails
 * completely silently.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { COMMAND_CHANNELS, EVENT_CHANNELS } from '@shared/ipc'
import type { WorkspacesApi } from '@shared/ipc'
import { contextBridge, ipcRenderer, webFrame } from './stubs/electron'

let api: WorkspacesApi

beforeAll(async () => {
  // The preload reads the OS version to derive the ConPTY build number; plain
  // Node has no `getSystemVersion`.
  ;(process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion = () => '10.0.26200'

  await import('../src/preload/index')
  api = contextBridge.exposed.get('elena') as unknown as WorkspacesApi
})

beforeEach(() => {
  ipcRenderer.reset()
  webFrame.zoomFactor = 1
})

describe('exposed surface', () => {
  it('exposes exactly the bridge members and nothing generic', () => {
    expect(Object.keys(api as unknown as Record<string, unknown>).sort()).toEqual(
      ['invoke', 'platform', 'subscribe', 'windowsBuild', 'zoomIn', 'zoomOut'].sort()
    )
  })

  it('exposes the bridge under a single world key', () => {
    expect([...contextBridge.exposed.keys()]).toEqual(['elena'])
  })
})

describe('invoke allowlist', () => {
  it('forwards every allowlisted command with its payload', async () => {
    for (const channel of COMMAND_CHANNELS) {
      await api.invoke(channel as never, { probe: channel } as never)
    }
    expect(ipcRenderer.invoked.map((call) => call.channel)).toEqual([...COMMAND_CHANNELS])
    expect(ipcRenderer.invoked[0]?.payload).toEqual({ probe: COMMAND_CHANNELS[0] })
  })

  it('refuses an unknown command without touching ipcRenderer', async () => {
    const result = await api.invoke('workspace:nuke' as never)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(ipcRenderer.invoked).toEqual([])
  })
})

describe('subscribe allowlist', () => {
  it('registers a listener for every allowlisted event', () => {
    for (const channel of EVENT_CHANNELS) api.subscribe(channel as never, () => {})
    expect([...ipcRenderer.listeners.keys()].sort()).toEqual([...EVENT_CHANNELS].sort())
  })

  it('unsubscribes with the same wrapped reference it registered', () => {
    const channel = EVENT_CHANNELS[0] as never
    const unsubscribe = api.subscribe(channel, () => {})

    expect(ipcRenderer.listeners.get(channel)?.size).toBe(1)
    unsubscribe()
    expect(ipcRenderer.listeners.get(channel)?.size).toBe(0)
  })

  it('delivers the payload without the Electron event object', () => {
    const seen: unknown[] = []
    api.subscribe('theme:changed', (payload) => seen.push(payload))

    const listener = [...(ipcRenderer.listeners.get('theme:changed') ?? [])][0]
    listener?.({ senderId: 1 }, { resolvedTheme: 'dark' })

    expect(seen).toEqual([{ resolvedTheme: 'dark' }])
  })

  it('drops an unknown event silently and registers nothing', () => {
    // This is the silent failure mode the contract test guards from the other
    // side: no error is thrown, so only the absent listener is observable.
    const unsubscribe = api.subscribe('terminal:telemetry' as never, () => {})

    expect(typeof unsubscribe).toBe('function')
    expect(ipcRenderer.listeners.size).toBe(0)
    expect(() => unsubscribe()).not.toThrow()
  })
})

describe('zoom', () => {
  it('clamps to the supported range', () => {
    for (let i = 0; i < 40; i += 1) api.zoomIn()
    expect(webFrame.zoomFactor).toBeLessThanOrEqual(2)

    for (let i = 0; i < 80; i += 1) api.zoomOut()
    expect(webFrame.zoomFactor).toBeGreaterThanOrEqual(0.5)
  })
})
