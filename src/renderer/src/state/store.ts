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
  moveTerminal,
  removeTerminal,
  setRatio,
  splitTerminal
} from '@shared/layout'
import type { DropPosition } from '@shared/layout'
import { DEFAULT_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_LINE_HEIGHT } from '@shared/terminalTypography'
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
import { loadBrowserPrefs, reconcileBrowserPrefs } from '../lib/uiPrefs'
import { clearTerminalBacklog } from '../lib/terminalBus'
import { acquireTerminal, getTerminal, releaseTerminal } from '../lib/terminalRegistry'

export type Toast = {
  id: string
  title: string
  body: string
  tone: 'info' | 'error'
}

export type NewTerminalRequest = {
  /** Captured at intent time, before any asynchronous validation. */
  workspaceId?: string
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
  openWorkspaceIds: string[]
  collapsedWorkspaceIds: string[]
  activeWorkspaceId: string | null
  activeTerminalId: string | null
  zoomedTerminalId: string | null
  pendingCloseTerminalId: string | null
  sessions: Record<string, RuntimeSession>
  unread: Record<string, boolean>
  /**
   * Terminals currently shown in their own window. Owned by the main process
   * and mirrored here; like `sessions` it never round-trips to disk, so a
   * relaunch always starts with everything in the main window.
   */
  detachedTerminalIds: string[]
  presets: AgentPreset[]
  shells: ShellInfo[]
  settings: AppSettings
  resolvedTheme: ResolvedTheme
  toasts: Toast[]

  bootstrap: (preferredWorkspaceId?: string) => Promise<void>
  refreshWorkspaces: () => Promise<void>
  createWorkspace: (name: string, projectRoot: string) => Promise<Workspace | null>
  renameWorkspace: (id: string, name: string) => Promise<boolean>
  deleteWorkspace: (id: string) => Promise<void>
  selectWorkspace: (id: string) => void
  closeProject: (id: string) => void
  toggleProjectCollapsed: (id: string) => void
  openWorkspaceById: (id: string) => Promise<void>

  startQuickSession: (presetId: string) => Promise<void>
  addTerminal: (request: NewTerminalRequest) => Promise<string>
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
  moveTerminalTo: (sourceId: string, targetId: string, position: DropPosition) => Promise<void>
  swapWithNeighbour: (direction: 1 | -1) => Promise<void>
  detachTerminal: (terminalId: string) => Promise<void>
  reattachTerminal: (terminalId: string) => Promise<void>
  setDetachedTerminalIds: (terminalIds: string[], ownTerminalId?: string | null) => void
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
  terminalFontFamily: null,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  terminalLineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
  scrollback: 10_000,
  confirmCloseRunning: true,
  warnOnMultilinePaste: true,
  gpuRendering: true,
  defaultShellId: null,
  explorerContextMenu: true
}

/**
 * One `workspace:update` per animation frame, carrying the newest layout.
 * Module scope, not store state: this is transport pacing, and holding it in the
 * store would make every drag frame a state update of its own.
 */
let pendingLayout: { workspaceId: string; layout: LayoutNode | null } | null = null
let layoutFrame: number | null = null

function scheduleLayoutSend(workspaceId: string, layout: LayoutNode | null): void {
  pendingLayout = { workspaceId, layout }
  if (layoutFrame !== null) return
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null
    const next = pendingLayout
    pendingLayout = null
    if (!next) return
    void call('workspace:update', { id: next.workspaceId, patch: { layout: next.layout } }).catch(() => {
      /* transient; the next drag frame will retry */
    })
  })
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  workspaces: [],
  openWorkspaceIds: [],
  collapsedWorkspaceIds: [],
  activeWorkspaceId: null,
  activeTerminalId: null,
  zoomedTerminalId: null,
  pendingCloseTerminalId: null,
  sessions: {},
  unread: {},
  detachedTerminalIds: [],
  presets: [],
  shells: [],
  settings: DEFAULT_SETTINGS,
  resolvedTheme: 'dark',
  toasts: [],

  async bootstrap(preferredWorkspaceId) {
    try {
      const [workspaces, presets, shells, settingsResult, sessions, detached] = await Promise.all([
        call('workspace:list'),
        call('preset:list'),
        call('shell:list'),
        call('settings:get'),
        call('terminal:list-sessions'),
        call('window:detached')
      ])
      // A detached window is told which workspace it belongs to; the main
      // window has no preference and opens the first one.
      //
      // An `activeWorkspaceId` already set means something chose one while
      // these six calls were in flight — in practice a shell "Open in Elena"
      // arriving through `workspace:open-requested`. It starts null, so there
      // is no other way for it to be set here, and honouring it keeps that
      // choice from being overwritten by whichever workspace happens to be
      // first. Without this the outcome would rest on all six handlers staying
      // synchronous, which nothing enforces.
      const chosen = get().activeWorkspaceId
      const chrome = reconcileBrowserPrefs(loadBrowserPrefs(), workspaces.map((w) => w.id), preferredWorkspaceId ?? chosen ?? undefined)
      const first = workspaces.find((w) => w.id === chrome.activeWorkspaceId)
      set({
        ready: true,
        ...chrome,
        workspaces,
        presets,
        shells,
        settings: settingsResult.settings,
        resolvedTheme: settingsResult.resolvedTheme,
        sessions: Object.fromEntries(sessions.map((s) => [s.terminalId, s])),
        detachedTerminalIds: detached.terminalIds,
        activeWorkspaceId: first?.id ?? null,
        activeTerminalId: first?.terminals.find((t) => t.id === first.activeTerminalId)?.id ?? first?.terminals[0]?.id ?? null
      })
    } catch (error) {
      set({ ready: true })
      get().pushError(error)
    }
  },

  async refreshWorkspaces() {
    try {
      const workspaces = await call('workspace:list')
      set((state) => {
        const chrome = reconcileBrowserPrefs(state, workspaces.map((w) => w.id))
        const active = workspaces.find((w) => w.id === chrome.activeWorkspaceId)
        const activeTerminalId = active?.terminals.some((t) => t.id === state.activeTerminalId)
          ? state.activeTerminalId : active?.terminals.find((t) => t.id === active.activeTerminalId)?.id ?? active?.terminals[0]?.id ?? null
        return { workspaces, ...chrome, activeTerminalId }
      })
    } catch (error) {
      get().pushError(error)
    }
  },

  async createWorkspace(name, projectRoot) {
    try {
      const workspace = await call('workspace:create', { name, projectRoot })
      set((state) => ({
        workspaces: state.workspaces.some((w) => w.id === workspace.id) ? state.workspaces : [...state.workspaces, workspace],
        openWorkspaceIds: [...new Set([...state.openWorkspaceIds, workspace.id])],
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
      // Reuse the sole terminal release path before deleting the saved project.
      const terminals = get().workspaces.find((w) => w.id === id)?.terminals ?? []
      for (const terminal of terminals) await get().closeTerminal(terminal.id)
      await call('workspace:delete', { id })
      set((state) => {
        const workspaces = state.workspaces.filter((w) => w.id !== id)
        const chrome = reconcileBrowserPrefs(state, workspaces.map((w) => w.id))
        const active = workspaces.find((w) => w.id === chrome.activeWorkspaceId)
        const ids = new Set(state.workspaces.find((w) => w.id === id)?.terminals.map((t) => t.id) ?? [])
        return {
          workspaces,
          ...chrome,
          sessions: Object.fromEntries(Object.entries(state.sessions).filter(([terminalId]) => !ids.has(terminalId))),
          unread: Object.fromEntries(Object.entries(state.unread).filter(([terminalId]) => !ids.has(terminalId))),
          activeTerminalId: state.activeWorkspaceId === id ? active?.terminals.find((t) => t.id === active.activeTerminalId)?.id ?? active?.terminals[0]?.id ?? null : state.activeTerminalId,
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

  /**
   * Switches to a workspace the main process picked — the Explorer "Open in
   * Elena" path. The workspace may have been created a moment ago, so a list
   * that does not know it yet is re-read rather than treated as a miss.
   */
  async openWorkspaceById(id) {
    if (!get().workspaces.some((workspace) => workspace.id === id)) {
      await get().refreshWorkspaces()
    }
    const workspace = get().workspaces.find((w) => w.id === id)
    if (!workspace) return
    try {
      await call('path:validate', { path: workspace.projectRoot })
      get().selectWorkspace(id)
    } catch (error) {
      get().pushError(error)
    }
  },

  selectWorkspace(id) {
    const workspace = get().workspaces.find((w) => w.id === id)
    if (!workspace) return
    const activeTerminalId = workspace.terminals.some((t) => t.id === workspace.activeTerminalId)
      ? workspace.activeTerminalId! : workspace.terminals[0]?.id ?? null
    set((state) => {
      const unread = { ...state.unread }
      if (activeTerminalId && !state.detachedTerminalIds.includes(activeTerminalId)) delete unread[activeTerminalId]
      return {
        openWorkspaceIds: [...new Set([...state.openWorkspaceIds, id])],
        collapsedWorkspaceIds: state.collapsedWorkspaceIds.filter((item) => item !== id),
        activeWorkspaceId: id,
        zoomedTerminalId: null,
        activeTerminalId,
        unread
      }
    })
  },

  closeProject(id) {
    set((state) => {
      const openWorkspaceIds = state.openWorkspaceIds.filter((item) => item !== id)
      const activeWorkspaceId = state.activeWorkspaceId === id ? openWorkspaceIds[0] ?? null : state.activeWorkspaceId
      const active = state.workspaces.find((w) => w.id === activeWorkspaceId)
      return {
        openWorkspaceIds,
        collapsedWorkspaceIds: state.collapsedWorkspaceIds.filter((item) => item !== id),
        activeWorkspaceId,
        activeTerminalId: state.activeWorkspaceId === id ? active?.terminals.find((t) => t.id === active.activeTerminalId)?.id ?? active?.terminals[0]?.id ?? null : state.activeTerminalId,
        zoomedTerminalId: null
      }
    })
  },

  toggleProjectCollapsed(id) {
    set((state) => ({
      collapsedWorkspaceIds: state.collapsedWorkspaceIds.includes(id)
        ? state.collapsedWorkspaceIds.filter((item) => item !== id) : [...state.collapsedWorkspaceIds, id]
    }))
  },

  /**
   * Starts an agent session without the user preparing a workspace first.
   * Every PTY still needs one for its cwd jail, so the main process hands back
   * a scratch workspace on the home directory and the normal add/start path
   * takes over from there.
   */
  async startQuickSession(presetId) {
    const preset = get().presets.find((item) => item.id === presetId)
    if (!preset) {
      get().pushToast({ title: 'Preset not found', body: 'That agent preset no longer exists.', tone: 'error' })
      return
    }
    if (!preset.executable) {
      get().pushToast({
        title: `${preset.name} is not configured`,
        body: preset.installHint ?? 'Set an executable for this preset in Settings → Presets.',
        tone: 'error'
      })
      return
    }

    try {
      const workspace = await call('workspace:ensure-scratch')
      set((state) => ({
        workspaces: state.workspaces.some((w) => w.id === workspace.id)
          ? state.workspaces.map((w) => (w.id === workspace.id ? workspace : w))
          : [...state.workspaces, workspace]
      }))
      get().selectWorkspace(workspace.id)
      await get().addTerminal({
        title: preset.name,
        executable: preset.executable,
        args: preset.args,
        // `defaultCwd` is relative to a project root that a scratch workspace
        // does not meaningfully have, so the root itself is the only safe cwd.
        cwd: workspace.projectRoot,
        envAllowlist: preset.envAllowlist,
        presetId: preset.id,
        spatialGrid: true
      })
    } catch (error) {
      get().pushError(error)
    }
  },

  async addTerminal(request) {
    const initial = get()
    const workspaceId = request.workspaceId ?? initial.activeWorkspaceId
    const original = initial.workspaces.find((w) => w.id === workspaceId)
    if (!original) throw new Error('The project is no longer available.')
    const validated = await call('path:validate', { path: request.cwd, mustBeInside: original.projectRoot })
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === workspaceId)
    if (!workspace) throw new Error('The project was deleted while creating the session.')
    const terminalId = crypto.randomUUID()
    const config: TerminalConfig = {
      id: terminalId,
      title: request.title,
      executable: request.executable,
      args: request.args,
      cwd: validated.path,
      envAllowlist: request.envAllowlist,
      ...(request.presetId ? { presetId: request.presetId } : {})
    }
    const anchor = initial.activeWorkspaceId === workspace.id ? initial.activeTerminalId : workspace.activeTerminalId
    const layout: LayoutNode = request.spatialGrid
      ? (buildSpatialGrid([...workspace.terminals.map((terminal) => terminal.id), terminalId], terminalId) ?? { type: 'terminal', terminalId })
      : request.split && anchor
        ? splitTerminal(workspace.layout, anchor, terminalId, request.split)
        : appendTerminal(workspace.layout, terminalId)
    const updated = await call('workspace:update', {
      id: workspace.id,
      patch: { terminals: [...workspace.terminals, config], layout, activeTerminalId: terminalId }
    })
    set((current) => ({
      workspaces: current.workspaces.map((w) => w.id === workspace.id ? updated : w),
      ...(current.activeWorkspaceId === workspace.id ? { activeTerminalId: terminalId } : {})
    }))
    // Creating a terminal is an explicit launch action. Restored configurations
    // remain idle until Start; the target stays fixed even if navigation changes.
    await get().startTerminal(terminalId, 80, 24)
    return terminalId
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
    const owner = state.workspaces.find((w) => w.terminals.some((t) => t.id === terminalId))
    if (!owner) return
    // A launch may finish after its group was hidden. Give it a bounded xterm
    // buffer even when no pane mounts, rather than leaving output in the backlog.
    acquireTerminal(terminalId, { scrollback: state.settings.scrollback, onOutput: () => get().markUnread(terminalId) })
    set((s) => ({
      sessions: { ...s.sessions, [terminalId]: { terminalId, status: 'starting' } }
    }))
    try {
      const session = await call('terminal:create', {
        workspaceId: owner.id,
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
    const workspaceId = get().workspaces.find((w) => w.terminals.some((t) => t.id === terminalId))?.id
    if (!workspaceId) return

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
    const remaining = terminals.map((t) => t.id)
    const ownerActive = remaining.includes(workspace.activeTerminalId ?? '') ? workspace.activeTerminalId! : remaining[0] ?? null
    const nextActive = state.activeWorkspaceId === workspaceId && !remaining.includes(state.activeTerminalId ?? '')
      ? ownerActive : state.activeTerminalId

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
      activeTerminalId: state.activeWorkspaceId === workspaceId ? nextActive : ownerActive
    })
  },

  focusTerminal(terminalId) {
    const current = get()
    const workspace = current.workspaces.find((w) => w.terminals.some((t) => t.id === terminalId))
    if (!workspace) return
    const ownerTab =
      workspace?.layout?.type === 'tabs'
        ? workspace.layout.tabs.find((tab) => collectTerminalIds(tab.layout).includes(terminalId))
        : undefined
    const layout = ownerTab ? activateTab(workspace?.layout ?? null, ownerTab.id) : workspace?.layout
    set((s) => {
      const unread = { ...s.unread }
      delete unread[terminalId]
      return {
        activeWorkspaceId: workspace.id,
        zoomedTerminalId: s.activeTerminalId === terminalId ? s.zoomedTerminalId : null,
        openWorkspaceIds: [...new Set([...s.openWorkspaceIds, workspace.id])],
        collapsedWorkspaceIds: s.collapsedWorkspaceIds.filter((id) => id !== workspace.id),
        activeTerminalId: terminalId,
        unread,
        workspaces: s.workspaces.map((w) => w.id === workspace.id
          ? { ...w, activeTerminalId: terminalId, ...(layout && layout !== workspace.layout ? { layout } : {}) } : w)
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
    const ids = workspace?.terminals.map((t) => t.id) ?? []
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

  async moveTerminalTo(sourceId, targetId, position) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    if (!workspace) return
    const layout = moveTerminal(workspace.layout, sourceId, targetId, position)
    // `moveTerminal` returns the same reference for a no-op, so an inert drop
    // costs no write.
    if (layout === workspace.layout) return
    // Only the tree changes: the terminal keeps its id, so its xterm instance
    // and scrollback are re-parented by the next mount rather than rebuilt.
    await persistWorkspace(set, get, workspace.id, { layout })
    set({ activeTerminalId: sourceId })
  },

  /** The keyboard route to the same rearrangement the drag gesture performs. */
  async swapWithNeighbour(direction) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    const ids = collectTerminalIds(workspace?.layout ?? null)
    const current = state.activeTerminalId ? ids.indexOf(state.activeTerminalId) : -1
    if (current === -1 || ids.length < 2) return
    const neighbour = ids[(current + direction + ids.length) % ids.length]
    if (!neighbour || neighbour === state.activeTerminalId) return
    await get().moveTerminalTo(state.activeTerminalId!, neighbour, 'swap')
  },

  async detachTerminal(terminalId) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.terminals.some((terminal) => terminal.id === terminalId))
    const config = workspace?.terminals.find((terminal) => terminal.id === terminalId)
    if (!workspace || !config) return
    try {
      // The layout is deliberately left alone: the pane stays in the tree and
      // renders a placeholder, so nothing about the workspace file changes and
      // closing the window puts the terminal straight back where it was.
      const { terminalIds } = await call('window:detach', {
        workspaceId: workspace.id,
        terminalId,
        title: config.title
      })
      set({ detachedTerminalIds: terminalIds })
    } catch (error) {
      get().pushError(error)
    }
  },

  async reattachTerminal(terminalId) {
    try {
      const { terminalIds } = await call('window:reattach', { terminalId })
      set({ detachedTerminalIds: terminalIds })
    } catch (error) {
      get().pushError(error)
    }
  },

  setDetachedTerminalIds(terminalIds, ownTerminalId) {
    // Output that arrived for a terminal this window no longer draws would sit
    // in the bus backlog forever; drop it at the moment ownership changes.
    // `ownTerminalId` is the terminal a detached window exists to show — its
    // backlog is the output waiting for a pane that has not mounted yet, so
    // clearing it here would throw away that window's first lines.
    const returning = get().detachedTerminalIds.filter((id) => !terminalIds.includes(id))
    for (const id of [...terminalIds, ...returning]) {
      if (id !== ownTerminalId) clearTerminalBacklog(id)
    }

    // While a terminal was in another window this one received none of its
    // output. Resuming the old buffer would splice two moments together with
    // no seam, so the pane restarts from live output instead of lying about
    // what it saw.
    for (const id of returning) getTerminal(id)?.term.clear()

    set({ detachedTerminalIds: terminalIds })
  },

  updateRatio(path, ratio) {
    const state = get()
    const workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
    if (!workspace) return
    const layout = setRatio(workspace.layout, path, ratio)
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === workspace.id ? { ...w, layout } : w))
    }))
    // P1: local state above is what the drag renders, so the send only has to
    // reach main often enough to survive a crash mid-drag. A high-polling mouse
    // fires pointermove well above the refresh rate; one send per frame is the
    // ceiling, and the frame the pointer stops on is always the one that lands.
    // Main debounces the disk write (FR-03) and coalesces the echo broadcast.
    scheduleLayoutSend(workspace.id, layout)
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
    if (get().activeTerminalId === terminalId || get().unread[terminalId]) return
    set((s) => ({ unread: { ...s.unread, [terminalId]: true } }))
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
