import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatCircleIcon } from '@phosphor-icons/react/ChatCircle'
import { FolderIcon } from '@phosphor-icons/react/Folder'
import { GearSixIcon } from '@phosphor-icons/react/GearSix'
import { InfoIcon } from '@phosphor-icons/react/Info'
import { ListIcon } from '@phosphor-icons/react/List'
import { PlusIcon } from '@phosphor-icons/react/Plus'
import { SquaresFourIcon } from '@phosphor-icons/react/SquaresFour'
import { collectTerminalIds } from '@shared/layout'
import type { UpdateState } from '@shared/types'
import { call, on } from './lib/api'
import { dispatchTerminalData } from './lib/terminalBus'
import {
  applyScrollbackToAll,
  applyTerminalTypographyToAll,
  applyThemeToAll,
  remeasureTerminalFonts
} from './lib/terminalRegistry'
import { selectActiveWorkspace, useStore } from './state/store'
import { loadSidebarHidden, loadSidebarWidth, saveSidebarHidden, saveSidebarWidth } from './lib/uiPrefs'
import { Sidebar, WORKSPACE_SEARCH_INPUT_ID } from './components/Sidebar'
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

type Modal =
  | 'none'
  | 'new-workspace'
  | 'rename-workspace'
  | 'rename-terminal'
  | 'new-terminal'
  | 'settings'
  | 'about'
  | 'delete-workspace'
  | 'palette'

/**
 * A window's role is fixed for its lifetime and comes from the URL the main
 * process loaded, so it is read once at module scope rather than held in state.
 * A detached window shows exactly one terminal and no workspace chrome.
 */
const windowParams = new URLSearchParams(window.location.search)
const detachedTerminalId = windowParams.get('role') === 'detached' ? windowParams.get('terminalId') : null
const detachedWorkspaceId = detachedTerminalId ? windowParams.get('workspaceId') : null

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
  const terminalFontFamily = useStore((s) => s.settings.terminalFontFamily)
  const terminalFontSize = useStore((s) => s.settings.terminalFontSize)
  const terminalLineHeight = useStore((s) => s.settings.terminalLineHeight)

  const applyStatus = useStore((s) => s.applyStatus)
  const applyExit = useStore((s) => s.applyExit)
  const setResolvedTheme = useStore((s) => s.setResolvedTheme)
  const pushToast = useStore((s) => s.pushToast)
  const pushError = useStore((s) => s.pushError)
  const updateRatio = useStore((s) => s.updateRatio)
  const activateTab = useStore((s) => s.activateTab)
  const cycleTerminal = useStore((s) => s.cycleTerminal)
  const toggleZoom = useStore((s) => s.toggleZoom)
  const requestTerminalClose = useStore((s) => s.requestTerminalClose)
  const cancelTerminalClose = useStore((s) => s.cancelTerminalClose)
  const confirmTerminalClose = useStore((s) => s.confirmTerminalClose)
  const stopTerminal = useStore((s) => s.stopTerminal)
  const deleteWorkspace = useStore((s) => s.deleteWorkspace)
  const arrangeSpatialGrid = useStore((s) => s.arrangeSpatialGrid)
  const presets = useStore((s) => s.presets)
  const startQuickSession = useStore((s) => s.startQuickSession)
  const swapWithNeighbour = useStore((s) => s.swapWithNeighbour)
  const detachTerminal = useStore((s) => s.detachTerminal)

  // A preset with no executable cannot start anything, so it is not offered as
  // a one-click action — it belongs in the New terminal dialog where the user
  // can see and fix why.
  const quickPresets = useMemo(() => presets.filter((preset) => preset.executable), [presets])

  const [modal, setModal] = useState<Modal>('none')
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const readyToastVersion = useRef<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const [sidebarHidden, setSidebarHidden] = useState(loadSidebarHidden)

  // The rail has to be on screen before its input can take focus, and any open
  // dialog has to be dismissed first: moving focus to a node behind an
  // aria-modal dialog would break the focus trap (NFR-22).
  const focusWorkspaceSearch = useCallback(() => {
    setModal('none')
    setSidebarHidden(false)
    requestAnimationFrame(() => {
      const input = document.getElementById(WORKSPACE_SEARCH_INPUT_ID)
      if (input instanceof HTMLInputElement) {
        input.focus()
        input.select()
      }
    })
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
    void bootstrap(detachedWorkspaceId ?? undefined)
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

  useEffect(() => saveSidebarWidth(sidebarWidth), [sidebarWidth])
  useEffect(() => saveSidebarHidden(sidebarHidden), [sidebarHidden])

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
        if (mine) dispatchTerminalData(terminalId, chunk)
      }),
      on('window:detached-changed', ({ terminalIds }) =>
        useStore.getState().setDetachedTerminalIds(terminalIds, detachedTerminalId)
      ),
      // Patches carry the whole `terminals` array, so a second window holding a
      // stale copy would overwrite terminals it never knew about. Re-reading on
      // every change is what keeps the windows converged.
      on('workspace:changed', () => void useStore.getState().refreshWorkspaces()),
      on('terminal:status-changed', ({ terminalId, status, pid }) => applyStatus(terminalId, status, pid)),
      on('terminal:exit', ({ terminalId, exitCode, signal }) => applyExit(terminalId, exitCode, signal)),
      on('theme:changed', ({ resolvedTheme: theme }) => setResolvedTheme(theme)),
      on('app:error', (error) => pushToast({ title: 'Error', body: error.message, tone: 'error' })),
      on('app:update-state', applyUpdateState)
    ]
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

  const terminalIds = useMemo(() => collectTerminalIds(workspace?.layout ?? null), [workspace?.layout])

  const commands = useMemo<Command[]>(
    () => [
      { id: 'new-terminal', label: 'New terminal', hint: 'Ctrl+T', run: () => setModal('new-terminal') },
      ...quickPresets.map((preset) => ({
        id: `quick-session-${preset.id}`,
        label: `Quick session: ${preset.name}`,
        hint: 'No workspace needed',
        run: () => void startQuickSession(preset.id)
      })),
      { id: 'new-workspace', label: 'New workspace', hint: 'Ctrl+Shift+N', run: () => setModal('new-workspace') },
      { id: 'settings', label: 'Open settings', hint: 'Ctrl+,', run: () => setModal('settings') },
      {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        hint: 'Ctrl+B',
        run: () => setSidebarHidden((hidden) => !hidden)
      },
      {
        id: 'search-workspaces',
        label: 'Search workspaces',
        hint: 'Ctrl+Shift+F',
        run: focusWorkspaceSearch
      },
      {
        id: 'arrange-grid',
        label: 'Arrange sessions in 2×2 grid',
        run: () => void arrangeSpatialGrid()
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
      arrangeSpatialGrid,
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
        if (workspace) setModal('new-terminal')
        return
      }
      if (key === 'n' && event.shiftKey) {
        event.preventDefault()
        setModal('new-workspace')
        return
      }
      if (key === ',') {
        event.preventDefault()
        setModal('settings')
        return
      }
      if (key === 'b' && !event.shiftKey) {
        event.preventDefault()
        setSidebarHidden((hidden) => !hidden)
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
      toggleZoom,
      workspace
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
    ? workspace?.terminals.find((t) => t.id === pendingCloseTerminalId)
    : undefined
  const detachedConfig = detachedTerminalId
    ? workspace?.terminals.find((t) => t.id === detachedTerminalId)
    : undefined

  const bodyClassName = [
    'app__body',
    sidebarHidden ? 'app__body--sidebar-hidden' : ''
  ]
    .filter(Boolean)
    .join(' ')

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
    <div className="app">
      <header className="commandbar">
        <button
          type="button"
          className="button button--icon"
          onClick={() => setSidebarHidden((hidden) => !hidden)}
          aria-expanded={!sidebarHidden}
          aria-controls="sidebar"
          aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
          title={`${sidebarHidden ? 'Show' : 'Hide'} sidebar (Ctrl+B)`}
        >
          <ListIcon size={20} />
        </button>
        <div className="commandbar__brand" aria-label="Elena">
          <img className="commandbar__mascot" src="./elena.png" alt="" />
          <span className="commandbar__brand-name">Elena</span>
        </div>
        {workspace && <span className="commandbar__divider" />}
        <div className="commandbar__workspace">
          {workspace && <span className="commandbar__title">{workspace.name}</span>}
          {workspace && (
            <>
              <span className="commandbar__divider" />
              <span className="commandbar__path" title={workspace.projectRoot}>
                <FolderIcon size={16} /> {workspace.projectRoot}
              </span>
              <span className="commandbar__divider" />
              <span className="commandbar__sessions">{terminalIds.length} sessions</span>
            </>
          )}
        </div>
        <span className="commandbar__spacer" />
        <button
          type="button"
          className="button button--primary"
          onClick={() => setModal('new-terminal')}
          disabled={!workspace}
          aria-label="New Terminal"
        >
          <PlusIcon size={18} /> New session
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void arrangeSpatialGrid()}
          disabled={!workspace?.layout}
          aria-label="Arrange spatial grid"
          title="Arrange sessions into pages of up to four"
        >
          <SquaresFourIcon size={18} /> Layout: 2×2
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setModal('about')}
          aria-label="About Elena"
          title="About Elena"
        >
          <InfoIcon size={19} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setModal('settings')}
          aria-label="Settings"
        >
          <GearSixIcon size={19} />
        </button>
      </header>

      <div
        className={bodyClassName}
        style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      >
        {!sidebarHidden && (
          <Sidebar
            workspace={workspace}
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            onHide={() => setSidebarHidden(true)}
            onNewWorkspace={() => setModal('new-workspace')}
            onNewTerminal={() => setModal('new-terminal')}
            onRenameWorkspace={() => setModal('rename-workspace')}
            onDeleteWorkspace={() => setModal('delete-workspace')}
          />
        )}

        <main className="app__main">
          {!ready && <div className="empty-state">Loading…</div>}

          {ready && !workspace && (
            <div className="empty-state">
              <div className="empty-state__title">No workspace yet</div>
              <p style={{ margin: 0, maxWidth: 460 }}>
                A workspace binds a project folder to a set of terminal sessions. Layout and configuration are
                restored on relaunch; processes are not restarted automatically.
              </p>
              <div className="empty-state__actions">
                <button type="button" className="button button--primary" onClick={() => setModal('new-workspace')}>
                  Create Workspace
                </button>
              </div>
              {quickPresets.length > 0 && (
                <>
                  <p className="empty-state__aside">
                    Or start an agent right away — Elena keeps these in a scratch workspace on your home
                    folder.
                  </p>
                  <div className="empty-state__actions">
                    {quickPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="button"
                        onClick={() => void startQuickSession(preset.id)}
                        title={`Start ${preset.name} without creating a workspace`}
                      >
                        <ChatCircleIcon size={17} /> {preset.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {ready && workspace && !workspace.layout && (
            <div className="empty-state">
              <div className="empty-state__title">{workspace.name}</div>
              <p style={{ margin: 0 }}>No terminals in this workspace yet.</p>
              <div className="empty-state__actions">
                <button type="button" className="button button--primary" onClick={() => setModal('new-terminal')}>
                  New Terminal
                </button>
              </div>
            </div>
          )}

          {ready && workspace?.layout && (
            <div className="layout">
              {zoomedConfig ? (
                <TerminalPane config={zoomedConfig} isActive />
              ) : (
                <SplitView
                  node={workspace.layout}
                  terminals={workspace.terminals}
                  activeTerminalId={activeTerminalId}
                  detachedTerminalIds={detachedTerminalIds}
                  onRatioChange={updateRatio}
                  onActivateTab={activateTab}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {modal === 'new-workspace' && <NewWorkspaceDialog onClose={() => setModal('none')} />}
      {modal === 'rename-workspace' && workspace && (
        <RenameWorkspaceDialog workspace={workspace} onClose={() => setModal('none')} />
      )}
      {modal === 'rename-terminal' && activeConfig && (
        <RenameTerminalDialog terminal={activeConfig} onClose={() => setModal('none')} />
      )}
      {modal === 'new-terminal' && workspace && (
        <NewTerminalDialog workspace={workspace} onClose={() => setModal('none')} />
      )}
      {modal === 'settings' && <SettingsDialog onClose={() => setModal('none')} />}
      {modal === 'about' && (
        <AboutDialog
          updateState={updateState}
          onCheck={async () => setUpdateState(await call('app:update-check'))}
          onClose={() => setModal('none')}
        />
      )}
      {modal === 'palette' && <CommandPalette commands={commands} onClose={() => setModal('none')} />}
      {modal === 'delete-workspace' && workspace && (
        <ConfirmDialog
          title="Delete workspace?"
          body={`"${workspace.name}" will be removed from Elena along with its session configuration. Files under ${workspace.projectRoot} are not touched.`}
          confirmLabel="Delete workspace"
          tone="danger"
          onCancel={() => setModal('none')}
          onConfirm={() => {
            setModal('none')
            void deleteWorkspace(workspace.id)
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
