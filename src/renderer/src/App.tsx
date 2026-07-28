import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderIcon } from '@phosphor-icons/react/Folder'
import { GearSixIcon } from '@phosphor-icons/react/GearSix'
import { ListIcon } from '@phosphor-icons/react/List'
import { PlusIcon } from '@phosphor-icons/react/Plus'
import { SquaresFourIcon } from '@phosphor-icons/react/SquaresFour'
import { collectTerminalIds } from '@shared/layout'
import { on } from './lib/api'
import { dispatchTerminalData } from './lib/terminalBus'
import { applyScrollbackToAll, applyThemeToAll } from './lib/terminalRegistry'
import { selectActiveWorkspace, useStore } from './state/store'
import { loadSidebarHidden, loadSidebarWidth, saveSidebarHidden, saveSidebarWidth } from './lib/uiPrefs'
import { Sidebar } from './components/Sidebar'
import { SplitView } from './components/SplitView'
import { TerminalPane } from './components/TerminalPane'
import { NewWorkspaceDialog } from './components/NewWorkspaceDialog'
import { RenameWorkspaceDialog } from './components/RenameWorkspaceDialog'
import { RenameTerminalDialog } from './components/RenameTerminalDialog'
import { NewTerminalDialog } from './components/NewTerminalDialog'
import { SettingsDialog } from './components/SettingsDialog'
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
  | 'delete-workspace'
  | 'palette'

export function App(): React.JSX.Element {
  const ready = useStore((s) => s.ready)
  const bootstrap = useStore((s) => s.bootstrap)
  const workspace = useStore(selectActiveWorkspace)
  const activeTerminalId = useStore((s) => s.activeTerminalId)
  const zoomedTerminalId = useStore((s) => s.zoomedTerminalId)
  const resolvedTheme = useStore((s) => s.resolvedTheme)
  const scrollback = useStore((s) => s.settings.scrollback)

  const applyStatus = useStore((s) => s.applyStatus)
  const applyExit = useStore((s) => s.applyExit)
  const setResolvedTheme = useStore((s) => s.setResolvedTheme)
  const pushToast = useStore((s) => s.pushToast)
  const updateRatio = useStore((s) => s.updateRatio)
  const activateTab = useStore((s) => s.activateTab)
  const cycleTerminal = useStore((s) => s.cycleTerminal)
  const toggleZoom = useStore((s) => s.toggleZoom)
  const closeTerminal = useStore((s) => s.closeTerminal)
  const stopTerminal = useStore((s) => s.stopTerminal)
  const deleteWorkspace = useStore((s) => s.deleteWorkspace)
  const arrangeSpatialGrid = useStore((s) => s.arrangeSpatialGrid)

  const [modal, setModal] = useState<Modal>('none')
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  const [sidebarHidden, setSidebarHidden] = useState(loadSidebarHidden)

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => saveSidebarWidth(sidebarWidth), [sidebarWidth])
  useEffect(() => saveSidebarHidden(sidebarHidden), [sidebarHidden])

  /* ---------- one subscription per event channel ---------- */
  useEffect(() => {
    const unsubscribers = [
      on('terminal:data', ({ terminalId, chunk }) => dispatchTerminalData(terminalId, chunk)),
      on('terminal:status-changed', ({ terminalId, status, pid }) => applyStatus(terminalId, status, pid)),
      on('terminal:exit', ({ terminalId, exitCode, signal }) => applyExit(terminalId, exitCode, signal)),
      on('theme:changed', ({ resolvedTheme: theme }) => setResolvedTheme(theme)),
      on('app:error', (error) => pushToast({ title: 'Error', body: error.message, tone: 'error' }))
    ]
    return () => unsubscribers.forEach((off) => off())
  }, [applyExit, applyStatus, pushToast, setResolvedTheme])

  /* ---------- theme is a single attribute flip: no remount, no buffer loss ---------- */
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    // xterm cannot read CSS variables, so live terminals are repainted in place.
    applyThemeToAll()
  }, [resolvedTheme])

  useEffect(() => {
    applyScrollbackToAll(scrollback)
  }, [scrollback])

  const terminalIds = useMemo(() => collectTerminalIds(workspace?.layout ?? null), [workspace?.layout])

  const commands = useMemo<Command[]>(
    () => [
      { id: 'new-terminal', label: 'New terminal', hint: 'Ctrl+T', run: () => setModal('new-terminal') },
      { id: 'new-workspace', label: 'New workspace', hint: 'Ctrl+Shift+N', run: () => setModal('new-workspace') },
      { id: 'settings', label: 'Open settings', hint: 'Ctrl+,', run: () => setModal('settings') },
      {
        id: 'toggle-sidebar',
        label: 'Toggle sidebar',
        hint: 'Ctrl+B',
        run: () => setSidebarHidden((hidden) => !hidden)
      },
      {
        id: 'arrange-grid',
        label: 'Arrange sessions in 2×2 grid',
        run: () => void arrangeSpatialGrid()
      },
      { id: 'theme-light', label: 'Theme: Light', run: () => void useStore.getState().updateSettings({ themePreference: 'light' }) },
      { id: 'theme-dark', label: 'Theme: Dark', run: () => void useStore.getState().updateSettings({ themePreference: 'dark' }) },
      { id: 'theme-system', label: 'Theme: System', run: () => void useStore.getState().updateSettings({ themePreference: 'system' }) },
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
        run: () => activeTerminalId && void closeTerminal(activeTerminalId)
      }
    ],
    [activeTerminalId, arrangeSpatialGrid, closeTerminal, cycleTerminal, stopTerminal, toggleZoom]
  )

  /* ---------- keyboard shortcuts (FR-21) ---------- */
  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      // F2 is the platform convention for rename and takes no modifier, so it
      // is handled before the Ctrl gate below.
      if (event.key === 'F2' && activeTerminalId) {
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
        window.aiWorkspaces.zoomIn()
        return
      }
      if (key === '-' || event.code === 'NumpadSubtract') {
        event.preventDefault()
        event.stopPropagation()
        window.aiWorkspaces.zoomOut()
        return
      }

      if (key === 'k') {
        event.preventDefault()
        setModal((current) => (current === 'palette' ? 'none' : 'palette'))
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
        void closeTerminal(activeTerminalId)
        return
      }
      if (key === 'z' && event.shiftKey && activeTerminalId) {
        event.preventDefault()
        toggleZoom(activeTerminalId)
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
    [activeTerminalId, closeTerminal, cycleTerminal, toggleZoom, workspace]
  )

  useEffect(() => {
    // Capture global commands before xterm consumes terminal keystrokes.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onKeyDown])

  const zoomedConfig = zoomedTerminalId
    ? workspace?.terminals.find((t) => t.id === zoomedTerminalId)
    : undefined
  const activeConfig = activeTerminalId
    ? workspace?.terminals.find((t) => t.id === activeTerminalId)
    : undefined
  const bodyClassName = [
    'app__body',
    sidebarHidden ? 'app__body--sidebar-hidden' : ''
  ]
    .filter(Boolean)
    .join(' ')

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
        <div className="commandbar__workspace">
          <span className="commandbar__title">{workspace?.name ?? 'AI Workspaces'}</span>
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
      {modal === 'palette' && <CommandPalette commands={commands} onClose={() => setModal('none')} />}
      {modal === 'delete-workspace' && workspace && (
        <ConfirmDialog
          title="Delete workspace?"
          body={`"${workspace.name}" will be removed from AI Workspaces along with its session configuration. Files under ${workspace.projectRoot} are not touched.`}
          confirmLabel="Delete workspace"
          tone="danger"
          onCancel={() => setModal('none')}
          onConfirm={() => {
            setModal('none')
            void deleteWorkspace(workspace.id)
          }}
        />
      )}
      <Toasts />
    </div>
  )
}
