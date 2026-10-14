import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UpdateState, Workspace } from '@shared/types'
import { call, on } from './lib/api'
import { dispatchTerminalData } from './lib/terminalBus'
import {
  applyGpuRenderingToAll,
  applyScrollbackToAll,
  applyTerminalTypographyToAll,
  applyThemeToAll,
  remeasureTerminalFonts
} from './lib/terminalRegistry'
import { selectActiveWorkspace, useStore } from './state/store'
import { saveBrowserPrefs } from './lib/uiPrefs'
import { BrowserChrome, splitViewNode } from './components/BrowserChrome'
import type { ChromePanel, SplitSelection } from './components/BrowserChrome'
import { DetachedPanePlaceholder } from './components/DetachedPanePlaceholder'
import { SplitView } from './components/SplitView'
import { TerminalPane } from './components/TerminalPane'
import { NewWorkspaceDialog } from './components/NewWorkspaceDialog'
import { RenameWorkspaceDialog } from './components/RenameWorkspaceDialog'
import { RenameTerminalDialog } from './components/RenameTerminalDialog'
import { NewTerminalDialog } from './components/NewTerminalDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { AboutDialog } from './components/AboutDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { CommandPalette } from './components/CommandPalette'
import type { Command } from './components/CommandPalette'
import { Toasts } from './components/Toasts'
import { ChangesDialog } from './components/ChangesDialog'

type Modal =
  | 'none'
  | 'new-workspace'
  | 'rename-workspace'
  | 'rename-terminal'
  | 'new-terminal'
  | 'settings'
  | 'about'
  | 'delete-workspace'
  | 'changes'
  | 'palette'

/**
 * A window's role is fixed for its lifetime and comes from the URL the main
 * process loaded, so it is read once at module scope rather than held in state.
 * A detached window shows exactly one terminal and no workspace chrome.
 */
const windowParams = new URLSearchParams(window.location.search)
const detachedTerminalId = windowParams.get('role') === 'detached' ? windowParams.get('terminalId') : null
/**
 * Which workspace this window opens on: the one a detached window belongs to,
 * or the one Explorer's "Open in Elena" resolved the folder to. Absent for an
 * ordinary launch, which lands on the first workspace.
 */
const initialWorkspaceId = windowParams.get('workspaceId')

export function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const bootstrap = useStore((s) => s.bootstrap)
  const workspace = useStore(selectActiveWorkspace)
  const activeTerminalId = useStore((s) => s.activeTerminalId)
  const zoomedTerminalId = useStore((s) => s.zoomedTerminalId)
  const pendingCloseTerminalId = useStore((s) => s.pendingCloseTerminalId)
  const detachedTerminalIds = useStore((s) => s.detachedTerminalIds)
  const resolvedTheme = useStore((s) => s.resolvedTheme)
  const scrollback = useStore((s) => s.settings.scrollback)
  const gpuRendering = useStore((s) => s.settings.gpuRendering)
  const terminalFontFamily = useStore((s) => s.settings.terminalFontFamily)
  const terminalFontSize = useStore((s) => s.settings.terminalFontSize)
  const terminalLineHeight = useStore((s) => s.settings.terminalLineHeight)

  const applyStatus = useStore((s) => s.applyStatus)
  const applyExit = useStore((s) => s.applyExit)
  const setResolvedTheme = useStore((s) => s.setResolvedTheme)
  const pushToast = useStore((s) => s.pushToast)
  const pushError = useStore((s) => s.pushError)
  const cycleTerminal = useStore((s) => s.cycleTerminal)
  const toggleZoom = useStore((s) => s.toggleZoom)
  const requestTerminalClose = useStore((s) => s.requestTerminalClose)
  const cancelTerminalClose = useStore((s) => s.cancelTerminalClose)
  const confirmTerminalClose = useStore((s) => s.confirmTerminalClose)
  const stopTerminal = useStore((s) => s.stopTerminal)
  const deleteWorkspace = useStore((s) => s.deleteWorkspace)
  const presets = useStore((s) => s.presets)
  const startQuickSession = useStore((s) => s.startQuickSession)
  const detachTerminal = useStore((s) => s.detachTerminal)

  // A preset with no executable cannot start anything, so it is not offered as
  // a one-click action — it belongs in the New terminal dialog where the user
  // can see and fix why.
  const quickPresets = useMemo(() => presets.filter((preset) => preset.executable), [presets])

  const [modal, setModal] = useState<Modal>('none')
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const readyToastVersion = useRef<string | null>(null)
  const openWorkspaceIds = useStore((s) => s.openWorkspaceIds)
  const collapsedWorkspaceIds = useStore((s) => s.collapsedWorkspaceIds)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const workspaces = useStore((s) => s.workspaces)
  const [panel, setPanel] = useState<ChromePanel>(null)
  const [split, setSplit] = useState<SplitSelection | null>(null)
  const [searchTerminalId, setSearchTerminalId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null)
  const swapWithNeighbour = useCallback((_direction: 1 | -1) => {
    setSplit((current) => current ? { ...current, ids: [current.ids[1], current.ids[0]] } : null)
  }, [])

  const focusWorkspaceSearch = useCallback(() => {
    setModal('none')
    setPanel('saved')
  }, [])

  const applyUpdateState = useCallback(
    (state: UpdateState): void => {
      setUpdateState(state)
      if (state.status === 'ready' && readyToastVersion.current !== state.latestVersion) {
        readyToastVersion.current = state.latestVersion
        pushToast({
          title: 'Update ready',
          body: `Elena ${state.latestVersion} is ready to install.`,
          tone: 'info'
        })
      }
    },
    [pushToast]
  )

  useEffect(() => {
    void bootstrap(initialWorkspaceId ?? undefined)
  }, [bootstrap])

  useEffect(() => {
    let active = true
    void call('app:update-status')
      .then((state) => {
        if (active) applyUpdateState(state)
      })
      .catch(pushError)
    return () => {
      active = false
    }
  }, [applyUpdateState, pushError])

  useEffect(() => {
    if (ready && !detachedTerminalId) saveBrowserPrefs({ openWorkspaceIds, collapsedWorkspaceIds, activeWorkspaceId })
  }, [ready, openWorkspaceIds, collapsedWorkspaceIds, activeWorkspaceId])

  useEffect(() => useStore.subscribe((state, previous) => {
    if (state.activeWorkspaceId !== previous.activeWorkspaceId) {
      setSplit(null)
      setSearchTerminalId(null)
    } else if (state.activeTerminalId !== previous.activeTerminalId) {
      setSplit((current) => current?.ids.includes(state.activeTerminalId ?? '') ? current : null)
      setSearchTerminalId(null)
    }
  }), [])

  /* ---------- one subscription per event channel ---------- */
  useEffect(() => {
    const unsubscribers = [
      on('terminal:data', ({ terminalId, chunk }) => {
        // `broadcast` reaches every window, so each one drops the output it
        // does not render. Without this the main window would accumulate a
        // backlog for every terminal that has been detached away from it.
        // Read through `getState` so ownership changes never resubscribe.
        const detached = useStore.getState().detachedTerminalIds
        const mine = detachedTerminalId ? terminalId === detachedTerminalId : !detached.includes(terminalId)
        // Up to 62.5 flushes/s × running terminals × their owning window.
        // O(1) unread lookup per chunk; no project aggregation or IPC here.
        if (mine) {
          if (!detachedTerminalId) useStore.getState().markUnread(terminalId)
          dispatchTerminalData(terminalId, chunk)
        }
      }),
      on('window:detached-changed', ({ terminalIds }) =>
        useStore.getState().setDetachedTerminalIds(terminalIds, detachedTerminalId)
      ),
      // Patches carry the whole `terminals` array, so a second window holding a
      // stale copy would overwrite terminals it never knew about. Re-reading on
      // every change is what keeps the windows converged.
      on('workspace:changed', () => void useStore.getState().refreshWorkspaces()),
      // Explorer asked a running Elena to open a folder. Only the main window
      // switches: a detached window renders one terminal and owns no workspace.
      on('workspace:open-requested', ({ workspaceId }) => {
        if (detachedTerminalId) return
        void useStore.getState().openWorkspaceById(workspaceId)
      }),
      on('terminal:status-changed', ({ terminalId, status, pid }) => applyStatus(terminalId, status, pid)),
      on('terminal:exit', ({ terminalId, exitCode, signal }) => applyExit(terminalId, exitCode, signal)),
      on('theme:changed', ({ resolvedTheme: theme }) => setResolvedTheme(theme)),
      // Broadcast reaches every window; only the main one reports app-level
      // failures, or a shell "Open in Elena" miss raises a toast per window.
      on('app:error', (error) => {
        if (detachedTerminalId) return
        pushToast({ title: 'Error', body: error.message, tone: 'error' })
      }),
      on('app:update-state', applyUpdateState)
    ]
    // Every subscription above now exists, so main can safely broadcast to this
    // window — it holds anything queued for a shell "Open in Elena" until this
    // call arrives, because `did-finish-load` fires before this effect runs and
    // the bus does not buffer. Detached windows return early from each of these
    // app-level events, so only the main window answers.
    // A failure here costs a queued folder, not the session; there is no
    // sensible retry and a toast would say nothing the user can act on.
    if (!detachedTerminalId) void call('app:renderer-ready').catch(() => {})
    return () => unsubscribers.forEach((off) => off())
  }, [applyExit, applyStatus, applyUpdateState, pushToast, setResolvedTheme])

  /* ---------- theme is a single attribute flip: no remount, no buffer loss ---------- */
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    // xterm cannot read CSS variables, so live terminals are repainted in place.
    applyThemeToAll()
  }, [resolvedTheme])

  useEffect(() => {
    applyScrollbackToAll(scrollback)
  }, [scrollback])

  useEffect(() => {
    applyGpuRenderingToAll(gpuRendering)
  }, [gpuRendering])

  useEffect(() => {
    applyTerminalTypographyToAll({
      fontFamily: terminalFontFamily,
      fontSize: terminalFontSize,
      lineHeight: terminalLineHeight
    })
  }, [terminalFontFamily, terminalFontSize, terminalLineHeight])

  // main.tsx already waits for the bundled face before mounting, but in dev the
  // stylesheet is injected asynchronously and that gate can resolve early. Any
  // terminal built against the fallback is re-measured here once fonts settle.
  useEffect(() => {
    let active = true
    void document.fonts.ready.then(() => {
      if (active) remeasureTerminalFonts()
    })
    return () => {
      active = false
    }
  }, [])

  const commands = useMemo<Command[]>(
    () => [
      { id: 'new-terminal', label: 'New session', hint: 'Ctrl+T', run: () => setPanel('new') },
      ...quickPresets.map((preset) => ({
        id: `quick-session-${preset.id}`,
        label: `Quick session: ${preset.name}`,
        hint: 'No workspace needed',
        run: () => void startQuickSession(preset.id)
      })),
      { id: 'new-workspace', label: 'New project', hint: 'Ctrl+Shift+N', run: () => setModal('new-workspace') },
      { id: 'settings', label: 'Open settings', hint: 'Ctrl+,', run: () => setModal('settings') },
      {
        id: 'saved-projects',
        label: 'Saved projects',
        hint: 'Ctrl+B',
        run: () => setPanel((current) => current === 'saved' ? null : 'saved')
      },
      {
        id: 'search-workspaces',
        label: 'Search saved projects',
        hint: 'Ctrl+Shift+F',
        run: focusWorkspaceSearch
      },
      { id: 'theme-light', label: 'Theme: Light', run: () => void useStore.getState().updateSettings({ themePreference: 'light' }) },
      { id: 'theme-dark', label: 'Theme: Dark', run: () => void useStore.getState().updateSettings({ themePreference: 'dark' }) },
      { id: 'theme-system', label: 'Theme: System', run: () => void useStore.getState().updateSettings({ themePreference: 'system' }) },
      {
        id: 'detach',
        label: 'Open focused terminal in a new window',
        run: () => activeTerminalId && void detachTerminal(activeTerminalId)
      },
      {
        id: 'swap-next',
        label: 'Swap pane with the next one',
        hint: 'Ctrl+Alt+Right',
        run: () => void swapWithNeighbour(1)
      },
      {
        id: 'swap-prev',
        label: 'Swap pane with the previous one',
        hint: 'Ctrl+Alt+Left',
        run: () => void swapWithNeighbour(-1)
      },
      { id: 'next-terminal', label: 'Focus next terminal', hint: 'Ctrl+PageDown', run: () => cycleTerminal(1) },
      { id: 'prev-terminal', label: 'Focus previous terminal', hint: 'Ctrl+PageUp', run: () => cycleTerminal(-1) },
      {
        id: 'rename-terminal',
        label: 'Rename focused terminal',
        hint: 'F2',
        run: () => activeTerminalId && setModal('rename-terminal')
      },
      {
        id: 'zoom',
        label: 'Zoom focused pane',
        hint: 'Ctrl+Shift+Z',
        run: () => activeTerminalId && toggleZoom(activeTerminalId)
      },
      {
        id: 'stop',
        label: 'Stop focused session',
        run: () => activeTerminalId && void stopTerminal(activeTerminalId)
      },
      {
        id: 'close',
        label: 'Close focused terminal',
        hint: 'Ctrl+W',
        run: () => activeTerminalId && requestTerminalClose(activeTerminalId)
      }
    ],
    [
      activeTerminalId,
      cycleTerminal,
      detachTerminal,
      focusWorkspaceSearch,
      quickPresets,
      requestTerminalClose,
      startQuickSession,
      stopTerminal,
      swapWithNeighbour,
      toggleZoom
    ]
  )

  /* ---------- keyboard shortcuts (FR-21) ---------- */
  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      // Unmodified keys must not be stolen from a text field the user is
      // typing into — this handler runs in capture phase on the whole window.
      // xterm receives keystrokes through a hidden textarea, so a focused
      // terminal looks exactly like a focused form field; excluding it is what
      // keeps F2 working in the case it exists for (FR-21).
      const target = event.target
      const inTerminal = target instanceof HTMLElement && target.closest('.pane__terminal') !== null
      const typing =
        !inTerminal &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable))

      // F2 is the platform convention for rename and takes no modifier, so it
      // is handled before the Ctrl gate below.
      if (event.key === 'F2' && !typing && !detachedTerminalId && activeTerminalId) {
        event.preventDefault()
        setModal('rename-terminal')
        return
      }

      const ctrl = event.ctrlKey || event.metaKey
      if (!ctrl) return
      const key = event.key.toLowerCase()

      if (key === '+' || key === '=' || event.code === 'NumpadAdd') {
        event.preventDefault()
        event.stopPropagation()
        window.elena.zoomIn()
        return
      }
      if (key === '-' || event.code === 'NumpadSubtract') {
        event.preventDefault()
        event.stopPropagation()
        window.elena.zoomOut()
        return
      }

      // Everything below either opens a modal this window does not render or
      // acts on `activeTerminalId`, which in a detached window is the
      // workspace's active terminal — a terminal living in the main window.
      // Swallowing those keys would also keep them from reaching the PTY, so a
      // detached window forwards them instead.
      if (detachedTerminalId) return

      if (key === 'k') {
        event.preventDefault()
        setPanel(null)
        setModal((current) => (current === 'palette' ? 'none' : 'palette'))
        return
      }
      // Not Ctrl+P: that is `previous-history` in PSReadLine and readline, and
      // this handler runs in capture phase, so claiming it would take history
      // recall away from every shell the app hosts.
      if (key === 'f' && event.shiftKey) {
        event.preventDefault()
        focusWorkspaceSearch()
        return
      }
      if (key === 't' && !event.shiftKey) {
        event.preventDefault()
        setModal('none')
        setPanel('new')
        return
      }
      if (key === 'n' && event.shiftKey) {
        event.preventDefault()
        setPanel(null)
        setModal('new-workspace')
        return
      }
      if (key === ',') {
        event.preventDefault()
        setPanel(null)
        setModal('settings')
        return
      }
      if (key === 'b' && !event.shiftKey) {
        event.preventDefault()
        setModal('none')
        setPanel((current) => current === 'saved' ? null : 'saved')
        return
      }
      if (key === 'w' && activeTerminalId) {
        event.preventDefault()
        requestTerminalClose(activeTerminalId)
        return
      }
      if (key === 'z' && event.shiftKey && activeTerminalId) {
        event.preventDefault()
        toggleZoom(activeTerminalId)
        return
      }
      // Ctrl+Alt+Arrow is the keyboard equivalent of dragging a pane onto its
      // neighbour (NFR-22): the same swap, without a pointer.
      if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        event.preventDefault()
        void swapWithNeighbour(event.key === 'ArrowRight' ? 1 : -1)
        return
      }
      if (event.key === 'PageDown') {
        event.preventDefault()
        cycleTerminal(1)
        return
      }
      if (event.key === 'PageUp') {
        event.preventDefault()
        cycleTerminal(-1)
      }
    },
    [
      activeTerminalId,
      cycleTerminal,
      focusWorkspaceSearch,
      requestTerminalClose,
      swapWithNeighbour,
      toggleZoom
    ]
  )

  useEffect(() => {
    // Capture global commands before xterm consumes terminal keystrokes.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onKeyDown])

  // A detached terminal has no pane here to zoom, so the zoom short-circuit
  // must not bypass the placeholder and mount a second xterm for it.
  const zoomedConfig =
    zoomedTerminalId && !detachedTerminalIds.includes(zoomedTerminalId)
      ? workspace?.terminals.find((t) => t.id === zoomedTerminalId)
      : undefined
  const activeConfig = activeTerminalId
    ? workspace?.terminals.find((t) => t.id === activeTerminalId)
    : undefined
  const pendingCloseConfig = pendingCloseTerminalId
    ? workspaces.flatMap((w) => w.terminals).find((t) => t.id === pendingCloseTerminalId)
    : undefined
  const detachedConfig = detachedTerminalId
    ? workspace?.terminals.find((t) => t.id === detachedTerminalId)
    : undefined

  const effectiveSplit = split && workspace && split.workspaceId === workspace.id && split.ids.includes(activeTerminalId ?? '') && split.ids.every((id) => workspace.terminals.some((t) => t.id === id)) ? split : null
  const singleConfig = zoomedConfig ?? activeConfig

  if (detachedTerminalId) {
    return (
      <div className="app app--detached">
        <main className="app__main">
          {!ready && <div className="empty-state">Loading…</div>}
          {ready && !detachedConfig && (
            <div className="empty-state">
              <div className="empty-state__title">Session closed</div>
              <p style={{ margin: 0 }}>This terminal no longer exists. You can close this window.</p>
            </div>
          )}
          {ready && detachedConfig && (
            <>
              {/*
                xterm instances cannot cross a BrowserWindow, so this window
                built a fresh one. Saying so beats letting the user wonder
                where their scrollback went.
              */}
              <p className="detached-notice" role="status">
                Scrollback continues from here — earlier output stayed in the main window.
              </p>
              <div className="layout">
                <TerminalPane config={detachedConfig} isActive />
              </div>
            </>
          )}
        </main>
        {pendingCloseTerminalId && (
          <ConfirmDialog
            title="Close running session?"
            body={`"${pendingCloseConfig?.title ?? 'This session'}" is still running. Closing it will terminate the process.`}
            confirmLabel="Terminate and close"
            tone="danger"
            onCancel={cancelTerminalClose}
            onConfirm={() => void confirmTerminalClose()}
          />
        )}
        <Toasts />
      </div>
    )
  }

  return (
    <div className="app app--browser">
      <BrowserChrome
        panel={panel} onPanel={setPanel}
        onNewWorkspace={() => setModal('new-workspace')}
        onConfigure={() => setModal('new-terminal')}
        onRenameWorkspace={() => setModal('rename-workspace')}
        onDeleteWorkspace={(target) => { setDeleteTarget(target); setModal('delete-workspace') }}
        onRenameTerminal={() => setModal('rename-terminal')}
        onSettings={() => setModal('settings')} onAbout={() => setModal('about')}
        onChanges={() => setModal('changes')} changesOpen={modal === 'changes'}
        onSearch={() => setSearchTerminalId((id) => id === activeTerminalId ? null : activeTerminalId)}
        split={effectiveSplit} onSplit={setSplit}
      />
      <main className="app__main" id="workspace-terminal" role="tabpanel" aria-label="Active terminal">
        {!ready && <div className="empty-state">Loading…</div>}
        {ready && !workspace && (
          <div className="empty-state">
            <div className="empty-state__title">{workspaces.length ? 'No project open' : 'No projects yet'}</div>
            <p>Open a saved project or choose a folder for a new one.</p>
            <div className="empty-state__actions">
              {workspaces.length > 0 && <button type="button" className="button button--primary" onClick={() => setPanel('saved')}>Open saved project</button>}
              <button type="button" className="button" onClick={() => setModal('new-workspace')}>New project</button>
            </div>
          </div>
        )}
        {ready && workspace && !activeConfig && (
          <div className="empty-state">
            <div className="empty-state__title">{workspace.name}</div>
            <p>No sessions in this project yet.</p>
            <button type="button" className="button" onClick={() => setPanel('new')}>New session</button>
          </div>
        )}
        {ready && workspace && singleConfig && (
          <div className="layout">
            {effectiveSplit && !zoomedConfig ? (
              <SplitView
                node={splitViewNode(effectiveSplit)} terminals={workspace.terminals}
                activeTerminalId={activeTerminalId} detachedTerminalIds={detachedTerminalIds}
                chrome="minimal" searchTerminalId={searchTerminalId} onSearchClose={() => setSearchTerminalId(null)}
                onRatioChange={(_path, ratio) => setSplit((current) => current?.workspaceId === effectiveSplit.workspaceId && current.ids[0] === effectiveSplit.ids[0] && current.ids[1] === effectiveSplit.ids[1] ? { ...current, ratio } : current)}
                onActivateTab={() => {}}
              />
            ) : detachedTerminalIds.includes(singleConfig.id) ? (
              <DetachedPanePlaceholder config={singleConfig} />
            ) : (
              <TerminalPane config={singleConfig} isActive chrome="none"
                searchVisible={searchTerminalId === singleConfig.id} onSearchClose={() => setSearchTerminalId(null)} />
            )}
          </div>
        )}
      </main>

      {modal === 'new-workspace' && <NewWorkspaceDialog onClose={() => setModal('none')} />}
      {modal === 'rename-workspace' && workspace && (
        <RenameWorkspaceDialog workspace={workspace} onClose={() => setModal('none')} />
      )}
      {modal === 'rename-terminal' && activeConfig && (
        <RenameTerminalDialog terminal={activeConfig} onClose={() => setModal('none')} />
      )}
      {modal === 'new-terminal' && workspace && (
        <NewTerminalDialog workspace={workspace} onClose={() => setModal('none')}
          onCreated={(id, direction, anchor) => {
            if (direction && anchor && useStore.getState().activeWorkspaceId === workspace.id) {
              setSplit({ workspaceId: workspace.id, ids: [anchor, id], direction, ratio: 0.5 })
            }
          }} />
      )}
      {modal === 'settings' && <SettingsDialog onClose={() => setModal('none')} />}
      {modal === 'about' && (
        <AboutDialog
          updateState={updateState}
          onCheck={async () => setUpdateState(await call('app:update-check'))}
          onClose={() => setModal('none')}
        />
      )}
      {modal === 'changes' && workspace && (
        <ChangesDialog workspace={workspace} onClose={() => setModal('none')} />
      )}
      {modal === 'palette' && <CommandPalette commands={commands} onClose={() => setModal('none')} />}
      {modal === 'delete-workspace' && deleteTarget && (
        <ConfirmDialog
          title="Delete saved project?"
          body={`"${deleteTarget.name}" will be removed from Saved projects along with its session configuration. Running sessions will stop. Files under ${deleteTarget.projectRoot} are not touched.`}
          confirmLabel="Delete saved project"
          tone="danger"
          onCancel={() => setModal('none')}
          onConfirm={() => {
            setModal('none')
            void deleteWorkspace(deleteTarget.id)
          }}
        />
      )}
      {pendingCloseTerminalId && (
        <ConfirmDialog
          title="Close running session?"
          body={`"${pendingCloseConfig?.title ?? 'This session'}" is still running. Closing it will terminate the process.`}
          confirmLabel="Terminate and close"
          tone="danger"
          onCancel={cancelTerminalClose}
          onConfirm={() => void confirmTerminalClose()}
        />
      )}
      <Toasts />
    </div>
  )
}
