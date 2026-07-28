/**
 * The only surface the renderer has on the main process.
 *
 * NFR-18: no generic `send`/`on` is exposed. `invoke` and `subscribe` reject any
 * channel that is not in the shared allowlist, so a compromised renderer cannot
 * reach an arbitrary ipcMain handler.
 */
import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { COMMAND_CHANNELS, EVENT_CHANNELS } from '@shared/ipc'
import type { CommandName, CommandRequest, CommandResponse, EventName, EventPayload } from '@shared/ipc'
import type { Result } from '@shared/types'

const commandChannels = new Set<string>(COMMAND_CHANNELS)
const eventChannels = new Set<string>(EVENT_CHANNELS)
const MIN_ZOOM_FACTOR = 0.5
const MAX_ZOOM_FACTOR = 2
const ZOOM_STEP = 0.1

function adjustZoom(delta: number): number {
  const next = Math.min(
    MAX_ZOOM_FACTOR,
    Math.max(MIN_ZOOM_FACTOR, Math.round((webFrame.getZoomFactor() + delta) * 10) / 10)
  )
  webFrame.setZoomFactor(next)
  return next
}

/**
 * xterm's `windowsPty` option needs the ConPTY build number to pick the right
 * resize behaviour. The renderer has no `process`, so it is parsed here from
 * the Electron-reported OS version ("10.0.26200" -> 26200).
 */
function windowsBuildNumber(): number | null {
  if (process.platform !== 'win32') return null
  const build = Number.parseInt(process.getSystemVersion().split('.')[2] ?? '', 10)
  return Number.isFinite(build) ? build : null
}

const api = {
  invoke<C extends CommandName>(channel: C, payload?: CommandRequest<C>): Promise<Result<CommandResponse<C>>> {
    if (!commandChannels.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'VALIDATION_FAILED', message: `Unknown command: ${String(channel)}` }
      })
    }
    return ipcRenderer.invoke(channel, payload)
  },

  subscribe<E extends EventName>(channel: E, listener: (payload: EventPayload<E>) => void): () => void {
    if (!eventChannels.has(channel)) return () => {}
    const wrapped = (_event: unknown, payload: EventPayload<E>): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.off(channel, wrapped)
    }
  },

  platform: process.platform,
  windowsBuild: windowsBuildNumber(),
  zoomIn: (): number => adjustZoom(ZOOM_STEP),
  zoomOut: (): number => adjustZoom(-ZOOM_STEP)
}

export type WorkspacesApi = typeof api

contextBridge.exposeInMainWorld('aiWorkspaces', api)
