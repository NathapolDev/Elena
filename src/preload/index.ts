/**
 * The only surface the renderer has on the main process.
 *
 * NFR-18: no generic `send`/`on` is exposed. `invoke` and `subscribe` reject any
 * channel that is not in the shared allowlist, so a compromised renderer cannot
 * reach an arbitrary ipcMain handler.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { COMMAND_CHANNELS, EVENT_CHANNELS } from '@shared/ipc'
import type { CommandName, CommandRequest, CommandResponse, EventName, EventPayload } from '@shared/ipc'
import type { Result } from '@shared/types'

const commandChannels = new Set<string>(COMMAND_CHANNELS)
const eventChannels = new Set<string>(EVENT_CHANNELS)

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

  platform: process.platform
}

export type WorkspacesApi = typeof api

contextBridge.exposeInMainWorld('aiWorkspaces', api)
