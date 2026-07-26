/**
 * A single terminal pane.
 *
 * The xterm instance is owned by `terminalRegistry`, not by this component, so
 * splitting, zooming or re-rendering the layout never destroys the buffer. This
 * component only adopts the terminal's DOM node and renders the chrome around
 * it (FR-25, split/zoom acceptance criteria).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/ArrowCounterClockwise'
import { ArrowsOutIcon } from '@phosphor-icons/react/ArrowsOut'
import { DotsThreeVerticalIcon } from '@phosphor-icons/react/DotsThreeVertical'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/MagnifyingGlass'
import { PlayIcon } from '@phosphor-icons/react/Play'
import { StopIcon } from '@phosphor-icons/react/Stop'
import { call } from '../lib/api'
import { formatSessionElapsed, relativeWorkspacePath } from '../lib/sessionPresentation'
import { acquireTerminal } from '../lib/terminalRegistry'
import { selectActiveWorkspace, useStore } from '../state/store'
import { StatusBadge } from './StatusBadge'
import { ConfirmDialog } from './ConfirmDialog'
import { RenameTerminalDialog } from './RenameTerminalDialog'
import type { TerminalConfig } from '@shared/types'

type Props = {
  config: TerminalConfig
  isActive: boolean
}

export function TerminalPane({ config, isActive }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  const session = useStore((s) => s.sessions[config.id])
  const workspace = useStore(selectActiveWorkspace)
  const hasUnread = useStore((s) => Boolean(s.unread[config.id]))
  const scrollback = useStore((s) => s.settings.scrollback)
  const warnOnMultilinePaste = useStore((s) => s.settings.warnOnMultilinePaste)
  const confirmCloseRunning = useStore((s) => s.settings.confirmCloseRunning)

  const restartTerminal = useStore((s) => s.restartTerminal)
  const closeTerminal = useStore((s) => s.closeTerminal)
  const stopTerminal = useStore((s) => s.stopTerminal)
  const focusTerminal = useStore((s) => s.focusTerminal)
  const toggleZoom = useStore((s) => s.toggleZoom)

  const [pendingPaste, setPendingPaste] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)

  const status = session?.status
  const isRunning = status === 'running' || status === 'starting'

  /* ---------- adopt the terminal's DOM node ---------- */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const entry = acquireTerminal(config.id, {
      scrollback,
      onOutput: () => useStore.getState().markUnread(config.id)
    })
    host.appendChild(entry.element)

    const refit = (): void => {
      try {
        entry.fit.fit()
      } catch {
        /* the pane can measure zero mid-layout */
      }
    }
    refit()

    const observer = new ResizeObserver(refit)
    observer.observe(host)

    return () => {
      observer.disconnect()
      // Hand the node back to the registry; do not dispose the terminal.
      if (entry.element.parentElement === host) host.removeChild(entry.element)
    }
    // scrollback changes are handled by a separate effect so this never re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id])

  useEffect(() => {
    if (isActive) {
      const entry = acquireTerminal(config.id, { scrollback, onOutput: () => {} })
      entry.term.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, config.id])

  /* ---------- multi-line paste warning (NFR-14) ---------- */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onPaste = (event: ClipboardEvent): void => {
      const text = event.clipboardData?.getData('text') ?? ''
      if (!warnOnMultilinePaste || !text.includes('\n')) return
      event.preventDefault()
      event.stopPropagation()
      setPendingPaste(text)
    }
    host.addEventListener('paste', onPaste, true)
    return () => host.removeEventListener('paste', onPaste, true)
  }, [warnOnMultilinePaste])

  const handleRestart = useCallback(() => {
    const entry = acquireTerminal(config.id, { scrollback, onOutput: () => {} })
    entry.term.clear()
    void restartTerminal(config.id, entry.term.cols, entry.term.rows)
  }, [config.id, restartTerminal, scrollback])

  const handleClose = useCallback(() => {
    // The store disposes the xterm instance as part of closing (terminalRegistry).
    void closeTerminal(config.id)
  }, [closeTerminal, config.id])

  const handleCloseRequest = useCallback(() => {
    if (isRunning && confirmCloseRunning) {
      setConfirmClose(true)
      return
    }
    handleClose()
  }, [confirmCloseRunning, handleClose, isRunning])

  const runSearch = useCallback(
    (needle: string, direction: 'next' | 'previous') => {
      if (!needle) return
      const entry = acquireTerminal(config.id, { scrollback, onOutput: () => {} })
      if (direction === 'next') entry.search.findNext(needle)
      else entry.search.findPrevious(needle)
    },
    [config.id, scrollback]
  )

  const selectAll = useCallback(() => {
    acquireTerminal(config.id, { scrollback, onOutput: () => {} }).term.selectAll()
  }, [config.id, scrollback])

  const clearScreen = useCallback(() => {
    const entry = acquireTerminal(config.id, { scrollback, onOutput: () => {} })
    entry.term.clear()
    entry.term.focus()
  }, [config.id, scrollback])

  return (
    <section
      className={`pane ${isActive ? 'pane--active' : ''}`}
      aria-label={`Terminal ${config.title}`}
      onMouseDown={() => focusTerminal(config.id)}
    >
      <header className="pane__header">
        <div className="pane__identity">
          <span
            className="pane__title"
            onDoubleClick={() => setRenaming(true)}
            title={`${config.title} — double-click to rename`}
          >
            {config.title}
          </span>
          <StatusBadge {...(session ? { session } : {})} />
        </div>
        <div className="pane__metadata">
          <span className="pane__cwd" title={config.cwd}>
            cwd: {workspace ? relativeWorkspacePath(workspace.projectRoot, config.cwd) : config.cwd}
          </span>
          <span>{formatSessionElapsed(session)}</span>
          {hasUnread && <span className="pane__new-output">New output</span>}
        </div>
        <div className="pane__actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => setSearchOpen((open) => !open)}
            aria-pressed={searchOpen}
            aria-label="Find in terminal"
            title="Search in terminal"
          >
            <MagnifyingGlassIcon size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={handleRestart}
            aria-label={session ? 'Restart' : 'Start'}
            title={session ? 'Restart session' : 'Start session'}
          >
            {session ? <ArrowCounterClockwiseIcon size={17} /> : <PlayIcon size={17} />}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void stopTerminal(config.id)}
            disabled={!isRunning}
            aria-label="Stop"
            title="Stop the running process"
          >
            <StopIcon size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => toggleZoom(config.id)}
            aria-label="Zoom pane"
            title="Zoom pane (Ctrl+Shift+Z)"
          >
            <ArrowsOutIcon size={17} />
          </button>
          <div className="pane__more">
            <button
              type="button"
              className="icon-button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-label="More session actions"
            >
              <DotsThreeVerticalIcon size={18} />
            </button>
            {moreOpen && (
              <div className="pane__menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setRenaming(true) }}>
                  Rename
                </button>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); selectAll() }}>
                  Select all
                </button>
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); clearScreen() }}>
                  Clear
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pane__menu-danger"
                  onClick={() => { setMoreOpen(false); handleCloseRequest() }}
                  title="Close terminal"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {searchOpen && (
        <div className="pane__notice">
          <label className="visually-hidden" htmlFor={`search-${config.id}`}>
            Search terminal buffer
          </label>
          <input
            id={`search-${config.id}`}
            autoFocus
            value={searchTerm}
            placeholder="Find in terminal"
            onChange={(event) => {
              setSearchTerm(event.target.value)
              runSearch(event.target.value, 'next')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch(searchTerm, event.shiftKey ? 'previous' : 'next')
              if (event.key === 'Escape') setSearchOpen(false)
            }}
          />
          <button type="button" className="button" onClick={() => runSearch(searchTerm, 'previous')}>
            Previous
          </button>
          <button type="button" className="button" onClick={() => runSearch(searchTerm, 'next')}>
            Next
          </button>
        </div>
      )}

      <div className="pane__terminal" ref={hostRef} />

      {status === 'exited' && (
        <div className="pane__notice" role="status">
          <span>
            Process exited
            {session?.exitCode === undefined ? '' : ` with code ${session.exitCode}`}
            {session?.endedAt ? ` at ${new Date(session.endedAt).toLocaleTimeString()}` : ''}.
          </span>
          <button type="button" className="button" onClick={handleRestart}>
            Restart
          </button>
          <button type="button" className="button" onClick={handleClose}>
            Close
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="pane__notice" role="alert">
          <span style={{ color: 'var(--status-error)' }}>{session?.errorMessage ?? 'Failed to start.'}</span>
          <button type="button" className="button" onClick={handleRestart}>
            Retry
          </button>
          <button type="button" className="button" onClick={handleClose}>
            Close
          </button>
        </div>
      )}

      {pendingPaste !== null && (
        <ConfirmDialog
          title="Paste multiple lines?"
          body={`This will paste ${pendingPaste.split('\n').length} lines into ${config.title}. A multi-line paste can run several commands at once.`}
          confirmLabel="Paste"
          onCancel={() => setPendingPaste(null)}
          onConfirm={() => {
            const text = pendingPaste
            setPendingPaste(null)
            void call('terminal:write', { terminalId: config.id, data: text }).catch(() => {})
          }}
        />
      )}

      {renaming && <RenameTerminalDialog terminal={config} onClose={() => setRenaming(false)} />}

      {confirmClose && (
        <ConfirmDialog
          title="Close running session?"
          body={`"${config.title}" is still running. Closing it will terminate the process.`}
          confirmLabel="Terminate and close"
          tone="danger"
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false)
            handleClose()
          }}
        />
      )}
    </section>
  )
}
