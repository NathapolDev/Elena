/**
 * Minimal Electron stub so main-process modules can be unit tested in plain
 * Node. Only the surface the code under test touches is implemented.
 *
 * Keep it thin on purpose: this stub is the pressure that keeps main-process
 * modules Electron-light. Do not turn it into a general Electron mock, and do
 * not move it behind vitest `setupFiles` (see AGENTS.md, Testing).
 *
 * `ipcMain`, `ipcRenderer`, `contextBridge`, `webFrame` and `webContents` are
 * recording fakes: the IPC guard suites register the real handlers against them
 * and then assert what was registered.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const app = {
  isPackaged: true,
  getPath: (name: string): string => join(tmpdir(), 'elena-tests', name),
  getVersion: (): string => '0.3.0'
}

export const nativeTheme = {
  themeSource: 'system' as 'system' | 'light' | 'dark',
  shouldUseDarkColors: true,
  on: () => {},
  off: () => {}
}

/* ---------- recording fakes for the IPC guard suites ---------- */

export type IpcHandler = (event: unknown, payload: unknown) => unknown

export const ipcMain = {
  handlers: new Map<string, IpcHandler>(),
  /** Duplicate registration is a contract violation, so it throws rather than overwrites. */
  handle(channel: string, handler: IpcHandler): void {
    if (ipcMain.handlers.has(channel)) {
      throw new Error(`ipcMain.handle called twice for channel: ${channel}`)
    }
    ipcMain.handlers.set(channel, handler)
  },
  removeHandler(channel: string): void {
    ipcMain.handlers.delete(channel)
  },
  reset(): void {
    ipcMain.handlers.clear()
  }
}

export type IpcRendererCall = { channel: string; payload: unknown }

export const ipcRenderer = {
  invoked: [] as IpcRendererCall[],
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    ipcRenderer.invoked.push({ channel, payload })
    return Promise.resolve({ ok: true, data: null })
  },
  on(channel: string, listener: (...args: unknown[]) => void): void {
    const set = ipcRenderer.listeners.get(channel) ?? new Set()
    set.add(listener)
    ipcRenderer.listeners.set(channel, set)
  },
  off(channel: string, listener: (...args: unknown[]) => void): void {
    ipcRenderer.listeners.get(channel)?.delete(listener)
  },
  reset(): void {
    ipcRenderer.invoked = []
    ipcRenderer.listeners.clear()
  }
}

export const contextBridge = {
  exposed: new Map<string, Record<string, unknown>>(),
  exposeInMainWorld(key: string, api: Record<string, unknown>): void {
    contextBridge.exposed.set(key, api)
  }
}

export const webFrame = {
  zoomFactor: 1,
  getZoomFactor: (): number => webFrame.zoomFactor,
  setZoomFactor: (value: number): void => {
    webFrame.zoomFactor = value
  }
}

export type FakeWebContents = {
  id: number
  destroyed: boolean
  sent: { channel: string; payload: unknown }[]
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
  once(event: string, listener: () => void): void
  emitDestroyed(): void
}

export function createWebContents(id: number): FakeWebContents {
  const onceListeners = new Map<string, (() => void)[]>()
  const contents: FakeWebContents = {
    id,
    destroyed: false,
    sent: [],
    isDestroyed: () => contents.destroyed,
    send: (channel, payload) => {
      contents.sent.push({ channel, payload })
    },
    once: (event, listener) => {
      onceListeners.set(event, [...(onceListeners.get(event) ?? []), listener])
    },
    emitDestroyed: () => {
      contents.destroyed = true
      for (const listener of onceListeners.get('destroyed') ?? []) listener()
      onceListeners.delete('destroyed')
    }
  }
  return contents
}

export const webContents = {
  all: [] as FakeWebContents[],
  getAllWebContents: (): FakeWebContents[] => webContents.all,
  reset(): void {
    webContents.all = []
  }
}

export const dialog = {
  showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: true,
    filePaths: []
  })
}

export const shell = {
  openExternal: async (): Promise<void> => {}
}

export class BrowserWindow {}
