/**
 * Renderer store.
 *
 * Persisted workspace state and ephemeral runtime state are deliberately
 * separate: `workspaces` round-trips to disk, `sessions`/`unread` never do,
 * because a restored session is a configuration and not a live process (FR-14).
 */
import { create } from 'zustand'
import {
  activateTab,
  appendTerminal,
  buildSpatialGrid,
  collectTerminalIds,
  removeTerminal,
  setRatio,
  splitTerminal
} from '@shared/layout'
import type {
  AgentPreset,
  AppSettings,
  LayoutNode,
  ResolvedTheme,
  RuntimeSession,
  SessionStatus,
  ShellInfo,
  TerminalConfig,
  Workspace
} from '@shared/types'
import { call, describeError } from '../lib/api'
import { clearTerminalBacklog } from '../lib/terminalBus'
import { releaseTerminal } from '../lib/terminalRegistry'

export type Toast = {
  id: string
  title: string
  body: string
  tone: 'info' | 'error'
}

export type NewTerminalRequest = {
  title: string
  executable: string
  args: string[]
  cwd: string
  envAllowlist: string[]
  presetId?: string
  /** When set, the new terminal splits the focused pane instead of appending. */
  split?: 'horizontal' | 'vertical'
  /** Auto-arranges the workspace into balanced pages of up to four panes. */
  spatialGrid?: boolean
}

type State = {
  ready: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeTerminalId: string | null
  zoomedTerminalId: string | null
  pendingCloseTerminalId: string | null
  sessions: Record<string, RuntimeSession>
  unread: Record<string, boolean>
  presets: AgentPreset[]
  shells: ShellInfo[]
  settings: AppSettings
  resolvedTheme: ResolvedTheme
  toasts: Toast[]

  bootstrap: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  createWorkspace: (name: string, projectRoot: string) => Promise<Workspace | null>
  renameWorkspace: (id: string, name: string) => Promise<boolean>
  deleteWorkspace: (id: string) => Promise<void>
  selectWorkspace: (id: string) => void

  addTerminal: (request: NewTerminalRequest) => Promise<void>
  renameTerminal: (terminalId: string, title: string) => Promise<boolean>
  startTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>
  restartTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>
  stopTerminal: (terminalId: string) => Promise<void>
  requestTerminalClose: (terminalId: string) => void
  cancelTerminalClose: () => void
  confirmTerminalClose: () => Promise<void>
  closeTerminal: (terminalId: string) => Promise<void>
  focusTerminal: (terminalId: string) => void
  toggleZoom: (terminalId: string) => void
  cycleTerminal: (direction: 1 | -1) => void
  activateTab: (tabId: string) => void
  arrangeSpatialGrid: () => Promise<void>
  updateRatio: (path: number[], ratio: number) => void

  applyStatus: (terminalId: string, status: SessionStatus, pid?: number) => void
  applyExit: (terminalId: string, exitCode?: number, signal?: number) => void
  markUnread: (terminalId: string) => void

  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  createPreset: (input: Omit<AgentPreset, 'id' | 'builtIn'>) => Promise<boolean>
  updatePreset: (id: string, patch: Partial<Omit<AgentPreset, 'id' | 'builtIn'>>) => Promise<boolean>
  deletePreset: (id: string) => Promise<boolean>
  resetPresets: () => Promise<boolean>
  setResolvedTheme: (theme: ResolvedTheme) => void

  pushToast: (toast: Omit<Toast, 'id'>) => void
  pushError: (error: unknown) => void
  dismissToast: (id: string) => void
}

const DEFAULT_SETTINGS: AppSettings = {
  themePreference: 'system',
  scrollback: 10_000,
  confirmCloseRunning: true,
  warnOnMultilinePaste: true,
  defaultShellId: null
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  workspaces: [],
  activeWorkspaceId: null,
  activeTerminalId: null,
  zoomedTerminalId: null,
  pendingCloseTerminalId: null,
  sessions: {},
  unread: {},
  presets: [],
  shells: [],
  settings: DEFAULT_SETTINGS,
  resolvedTheme: 'dark',
  toasts: [],

  async bootstrap() {
    try {
      const [workspaces, presets, shells, settingsResult, sessions] = await Promise.all([
        call('workspace:list'),
        call('preset:list'),
        call('shell:list'),
        call('settings:get'),
        call('terminal:list-sessions')
      ])
      const first = workspaces[0]
      set({
        ready: true,
        workspaces,
        presets,
        shells,
        settings: settingsResult.settings,
        resolvedTheme: settingsResult.resolvedTheme,
        sessions: Object.fromEntries(sessions.map((s) => [s.terminalId, s])),
        activeWorkspaceId: first?.id ?? null,
        activeTerminalId: first?.activeTerminalId ?? collectTerminalIds(first?.layout ?? null)[0] ?? null
      })
    } catch (error) {
      set({ ready: true })
      get().pushError(error)
    }
  },

  async refreshWorkspaces() {
    try {
      set({ workspaces: await call('workspace:list') })
    } catch (error) {
      get().pushError(error)
    }
  },

  async createWorkspace(name, projectRoot) {
    try {
      const workspace = await call('workspace:create', { name, projectRoot })
      set((state) => ({
        workspaces: [...state.workspaces, workspace],
        activeWorkspaceId: workspace.id,
        activeTerminalId: null
      }))
      return workspace
    } catch (error) {
      get().pushError(error)
      return null
    }
  },

  async deleteWorkspace(id) {
    try {
      await call('workspace:delete', { id })
      set((state) => {
        const workspaces = state.workspaces.filter((w) => w.id !== id)
        const nextActive = state.activeWorkspaceId === id ? (workspaces[0]?.id ?? null) : state.activeWorkspaceId
        return {
          workspaces,
          activeWorkspaceId: nextActive,
          activeTerminalId: null,
          zoomedTerminalId: null
        }
      })
    } catch (error) {
      get().pushError(error)
    }
  },

  async renameWorkspace(id, name) {
    try {
      const updated = await call('workspace:update', { id, patch: { name } })
      set((state) => ({
        workspaces: state.workspaces.map((workspace) => (workspace.id === id ? updated : workspace))
      }))
      return true
    } catch (error) {
      get().pushError(error)
      return false
    }
  },

  selectWorkspace(id) {
    const workspace = get().workspaces.find((w) => w.id === id)
    set({
      activeWorkspaceId: id,
      zoomedTerminalId: null,
      activeTerminalId: workspace?.activeTerminalId ?? collectTerminalIds(workspace?.layout ?? null)[0] ?? null
    })
  },

  async addTerminal(request) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    if (!workspace) return

    const terminalId = crypto.randomUUID()
    const config: TerminalConfig = {
      id: terminalId,
      title: request.title,
      executable: request.executable,
      args: request.args,
      cwd: request.cwd,
      envAllowlist: request.envAllowlist,
      ...(request.presetId ? { presetId: request.presetId } : {})
    }

    const layout: LayoutNode = request.spatialGrid
      ? (buildSpatialGrid([...workspace.terminals.map((terminal) => terminal.id), terminalId], terminalId) ?? {
          type: 'terminal',
          terminalId
        })
      : request.split && state.activeTerminalId
        ? splitTerminal(workspace.layout, state.activeTerminalId, terminalId, request.split)
        : appendTerminal(workspace.layout, terminalId)

    await persistWorkspace(set, get, workspace.id, {
      terminals: [...workspace.terminals, config],
      layout,
      activeTerminalId: terminalId
    })
    set({ activeTerminalId: terminalId })
    // Creating a terminal is an explicit launch action. Restored terminal
    // configurations take a different path and remain idle until Start.
    await get().startTerminal(terminalId, 80, 24)
  },

  async renameTerminal(terminalId, title) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    if (!workspace) return false

    const nextTitle = title.trim()
    // The schema rejects an empty title. Refusing here keeps the dialog open on
    // the user's text instead of bouncing a validation toast off the IPC layer.
    if (!nextTitle) return false

    const terminals = workspace.terminals.map((terminal) =>
      terminal.id === terminalId ? { ...terminal, title: nextTitle } : terminal
    )
    try {
      const updated = await call('workspace:update', { id: workspace.id, patch: { terminals } })
      set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === workspace.id ? updated : w)) }))
      return true
    } catch (error) {
      get().pushError(error)
      return false
    }
  },

  async startTerminal(terminalId, cols, rows) {
    const state = get()
    if (!state.activeWorkspaceId) return
    set((s) => ({
      sessions: { ...s.sessions, [terminalId]: { terminalId, status: 'starting' } }
    }))
    try {
      const session = await call('terminal:create', {
        workspaceId: state.activeWorkspaceId,
        terminalId,
        cols,
        rows
      })
      set((s) => ({ sessions: { ...s.sessions, [terminalId]: session } }))
    } catch (error) {
      const described = describeError(error)
      set((s) => ({
        sessions: {
          ...s.sessions,
          [terminalId]: { terminalId, status: 'error', errorMessage: described.body }
        }
      }))
      get().pushError(error)
    }
  },

  async restartTerminal(terminalId, cols, rows) {
    clearTerminalBacklog(terminalId)
    set((s) => ({ sessions: { ...s.sessions, [terminalId]: { terminalId, status: 'starting' } } }))
    try {
      const session = await call('terminal:restart', { terminalId, cols, rows })
      set((s) => ({ sessions: { ...s.sessions, [terminalId]: session } }))
    } catch (error) {
      const described = describeError(error)
      set((s) => ({
        sessions: {
          ...s.sessions,
          [terminalId]: { terminalId, status: 'error', errorMessage: described.body }
        }
      }))
      get().pushError(error)
    }
  },

  async stopTerminal(terminalId) {
    try {
      await call('terminal:terminate', { terminalId })
    } catch (error) {
      get().pushError(error)
    }
  },

  requestTerminalClose(terminalId) {
    const state = get()
    const status = state.sessions[terminalId]?.status
    const isRunning = status === 'running' || status === 'starting'
    if (isRunning && state.settings.confirmCloseRunning) {
      set({ pendingCloseTerminalId: terminalId })
      return
    }
    void state.closeTerminal(terminalId)
  },

  cancelTerminalClose() {
    set({ pendingCloseTerminalId: null })
  },

  async confirmTerminalClose() {
    const terminalId = get().pendingCloseTerminalId
    if (!terminalId) return
    set({ pendingCloseTerminalId: null })
    await get().closeTerminal(terminalId)
  },

  async closeTerminal(terminalId) {
    const workspaceId = get().activeWorkspaceId
    if (!workspaceId || !get().workspaces.some((w) => w.id === workspaceId)) return

    try {
      await call('terminal:terminate', { terminalId })
    } catch {
      // The session may already be gone; closing the pane is still correct.
    }
    clearTerminalBacklog(terminalId)
    releaseTerminal(terminalId)

    // The patch replaces `terminals` wholesale, so it must be built from the
    // list as it is *after* the await — and applied locally before the write —
    // or a second close overlapping this one would resurrect the first pane.
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === workspaceId)
    if (!workspace) return

    const terminals = workspace.terminals.filter((t) => t.id !== terminalId)
    const layout = removeTerminal(workspace.layout, terminalId)
    const remaining = collectTerminalIds(layout)
    const nextActive = state.activeTerminalId === terminalId ? (remaining[0] ?? null) : state.activeTerminalId

    set((s) => {
      const sessions = { ...s.sessions }
      const unread = { ...s.unread }
      delete sessions[terminalId]
      delete unread[terminalId]
      return {
        workspaces: s.workspaces.map((w) => (w.id === workspaceId ? { ...w, terminals, layout } : w)),
        sessions,
        unread,
        pendingCloseTerminalId: s.pendingCloseTerminalId === terminalId ? null : s.pendingCloseTerminalId,
        activeTerminalId: nextActive,
        zoomedTerminalId: s.zoomedTerminalId === terminalId ? null : s.zoomedTerminalId
      }
    })

    await persistWorkspace(set, get, workspaceId, {
      terminals,
      layout,
      activeTerminalId: nextActive
    })
  },

  focusTerminal(terminalId) {
    const current = get()
    const workspace = current.workspaces.find((w) => w.id === current.activeWorkspaceId)
    const ownerTab =
      workspace?.layout?.type === 'tabs'
        ? workspace.layout.tabs.find((tab) => collectTerminalIds(tab.layout).includes(terminalId))
        : undefined
    const layout = ownerTab ? activateTab(workspace?.layout ?? null, ownerTab.id) : workspace?.layout
    set((s) => {
      const unread = { ...s.unread }
      delete unread[terminalId]
      return {
        activeTerminalId: terminalId,
        unread,
        ...(workspace && layout && layout !== workspace.layout
          ? { workspaces: s.workspaces.map((w) => (w.id === workspace.id ? { ...w, layout } : w)) }
          : {})
      }
    })
    const { activeWorkspaceId } = get()
    if (activeWorkspaceId) {
      void call('workspace:update', {
        id: activeWorkspaceId,
        patch: { activeTerminalId: terminalId, ...(layout && layout !== workspace?.layout ? { layout } : {}) }
      }).catch(() => {
        /* focus is not worth a toast */
      })
    }
  },

  toggleZoom(terminalId) {
    set((s) => ({ zoomedTerminalId: s.zoomedTerminalId === terminalId ? null : terminalId }))
  },

  cycleTerminal(direction) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    const ids = collectTerminalIds(workspace?.layout ?? null)
    if (ids.length === 0) return
    const current = state.activeTerminalId ? ids.indexOf(state.activeTerminalId) : -1
    const next = ids[(current + direction + ids.length) % ids.length]
    if (next) get().focusTerminal(next)
  },

  activateTab(tabId) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    if (!workspace) return
    const layout = activateTab(workspace.layout, tabId)
    if (!layout || layout === workspace.layout) return
    const tab = layout.type === 'tabs' ? layout.tabs.find((item) => item.id === tabId) : undefined
    const activeTerminalId = collectTerminalIds(tab?.layout ?? null)[0] ?? state.activeTerminalId
    set((s) => ({
      activeTerminalId,
      workspaces: s.workspaces.map((w) =>
        w.id === workspace.id ? { ...w, layout, activeTerminalId: activeTerminalId ?? undefined } : w
      )
    }))
    void call('workspace:update', { id: workspace.id, patch: { layout, activeTerminalId } }).catch(() => {})
  },

  async arrangeSpatialGrid() {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    if (!workspace) return
    const terminalIds = workspace.terminals.map((terminal) => terminal.id)
    const layout = buildSpatialGrid(terminalIds, state.activeTerminalId ?? undefined)
    await persistWorkspace(set, get, workspace.id, { layout })
  },

  updateRatio(path, ratio) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    if (!workspace) return
    const layout = setRatio(workspace.layout, path, ratio)
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === workspace.id ? { ...w, layout } : w))
    }))
    // Main debounces the disk write (FR-03), so a drag is safe to send per frame.
    void call('workspace:update', { id: workspace.id, patch: { layout } }).catch(() => {
      /* transient; the next drag will retry */
    })
  },

  applyStatus(terminalId, status, pid) {
    set((s) => {
      const previous = s.sessions[terminalId] ?? { terminalId, status }
      return {
        sessions: {
          ...s.sessions,
          [terminalId]: { ...previous, status, ...(pid === undefined ? {} : { pid }) }
        }
      }
    })
  },

  applyExit(terminalId, exitCode, signal) {
    set((s) => {
      const previous = s.sessions[terminalId] ?? { terminalId, status: 'exited' as SessionStatus }
      return {
        sessions: {
          ...s.sessions,
          [terminalId]: {
            ...previous,
            status: 'exited',
            ...(exitCode === undefined ? {} : { exitCode }),
            ...(signal === undefined ? {} : { signal }),
            endedAt: new Date().toISOString()
          }
        }
      }
    })
  },

  markUnread(terminalId) {
    // FR-22: indicate, never steal focus.
    if (get().activeTerminalId === terminalId) return
    set((s) => (s.unread[terminalId] ? {} : { unread: { ...s.unread, [terminalId]: true } }))
  },

  async updateSettings(patch) {
    try {
      const result = await call('settings:update', patch)
      set({ settings: result.settings, resolvedTheme: result.resolvedTheme })
    } catch (error) {
      get().pushError(error)
    }
  },

  async createPreset(input) {
    try {
      const preset = await call('preset:create', input)
      set((state) => ({ presets: [...state.presets, preset] }))
      return true
    } catch (error) {
      get().pushError(error)
      return false
    }
  },

  async updatePreset(id, patch) {
    try {
      const preset = await call('preset:update', { id, patch })
      set((state) => ({ presets: state.presets.map((item) => (item.id === id ? preset : item)) }))
      return true
    } catch (error) {
      get().pushError(error)
      return false
    }
  },

  async deletePreset(id) {
    try {
      await call('preset:delete', { id })
      set((state) => ({ presets: state.presets.filter((item) => item.id !== id) }))
      return true
    } catch (error) {
      get().pushError(error)
      return false
    }
  },

  async resetPresets() {
    try {
      set({ presets: await call('preset:reset') })
      return true
    } catch (error) {
      get().pushError(error)
      return false
    }
  },

  setResolvedTheme(theme) {
    set({ resolvedTheme: theme })
  },

  pushToast(toast) {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    setTimeout(() => get().dismissToast(id), 8000)
  },

  pushError(error) {
    const described = describeError(error)
    get().pushToast({ title: described.title, body: described.body, tone: 'error' })
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
}))

/** Sends a workspace patch and mirrors the authoritative copy back into state. */
async function persistWorkspace(
  set: (partial: Partial<State> | ((state: State) => Partial<State>)) => void,
  get: () => State,
  workspaceId: string,
  patch: { terminals?: TerminalConfig[]; layout?: LayoutNode | null; activeTerminalId?: string | null }
): Promise<void> {
  try {
    const updated = await call('workspace:update', { id: workspaceId, patch })
    set((state) => ({
      workspaces: state.workspaces.map((w) => (w.id === workspaceId ? updated : w))
    }))
  } catch (error) {
    get().pushError(error)
  }
}

export function selectActiveWorkspace(state: State): Workspace | undefined {
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId)
}
