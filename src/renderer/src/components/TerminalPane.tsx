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
import { DotsSixVerticalIcon } from '@phosphor-icons/react/DotsSixVertical'
import { DotsThreeVerticalIcon } from '@phosphor-icons/react/DotsThreeVertical'
import { GitBranchIcon } from '@phosphor-icons/react/GitBranch'
import { ArrowSquareOutIcon } from '@phosphor-icons/react/ArrowSquareOut'
import { ListIcon } from '@phosphor-icons/react/List'
import { PlayIcon } from '@phosphor-icons/react/Play'
import { StopIcon } from '@phosphor-icons/react/Stop'
import { useGitBranch } from '../lib/gitBranch'
import { formatSessionElapsed, relativeWorkspacePath } from '../lib/sessionPresentation'
import { acquireTerminal } from '../lib/terminalRegistry'
import { selectActiveWorkspace, useStore } from '../state/store'
import { StatusBadge } from './StatusBadge'
import { ConfirmDialog } from './ConfirmDialog'
import { RenameTerminalDialog } from './RenameTerminalDialog'
import type { DropPosition } from '@shared/layout'
import type { TerminalConfig } from '@shared/types'

type Props = {
  config: TerminalConfig
  isActive: boolean
}

/**
 * A private MIME type, so a pane only accepts a drag that started on another
 * pane — a dragged file or a text selection is not a layout move.
 */
const TERMINAL_DRAG_TYPE = 'application/x-elena-terminal'

const DROP_LABELS: Record<DropPosition, string> = {
  left: 'Move left',
  right: 'Move right',
  top: 'Move above',
  bottom: 'Move below',
  swap: 'Swap panes'
}

/**
 * Below this the icon row stops fitting beside the title and the status badge,
 * and the two start overlapping. Measured on the pane, not the window: a pane
 * in a 2×2 grid is narrow long before the window is.
 */
const COMPACT_PANE_WIDTH = 420

export function TerminalPane({ config, isActive }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)

  const session = useStore((s) => s.sessions[config.id])
  const workspace = useStore(selectActiveWorkspace)
  const hasUnread = useStore((s) => Boolean(s.unread[config.id]))
  const scrollback = useStore((s) => s.settings.scrollback)
  const warnOnMultilinePaste = useStore((s) => s.settings.warnOnMultilinePaste)

  const restartTerminal = useStore((s) => s.restartTerminal)
  const requestTerminalClose = useStore((s) => s.requestTerminalClose)
  const stopTerminal = useStore((s) => s.stopTerminal)
  const focusTerminal = useStore((s) => s.focusTerminal)
  const toggleZoom = useStore((s) => s.toggleZoom)

  const [pendingPaste, setPendingPaste] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null)
  const [compact, setCompact] = useState(false)
  const compactRef = useRef(false)

  const moveTerminalTo = useStore((s) => s.moveTerminalTo)
  const detachTerminal = useStore((s) => s.detachTerminal)

  const status = session?.status
  const isRunning = status === 'running' || status === 'starting'

  // Polled from the pane's own cwd, so panes on different folders of the same
  // repo — or on different repos — each show their own branch.
  const git = useGitBranch(config.cwd)

  /* ---------- adopt the terminal's DOM node ---------- */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const entry = acquireTerminal(config.id, {
      scrollback,
      onOutput: () => useStore.getState().markUnread(config.id)
    })
    host.appendChild(entry.element)

    entry.fitNow()

    // Debounced in the registry: a divider drag fires this on every pointer
    // move, and one ConPTY resize per move corrupts the prompt row.
    const observer = new ResizeObserver(entry.scheduleFit)
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

  /* ---------- collapse the header when the pane gets narrow ---------- */
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    const measure = (width: number): void => {
      const next = width > 0 && width < COMPACT_PANE_WIDTH
      if (compactRef.current === next) return
      compactRef.current = next
      setCompact(next)
      // A menu left open across the switch would be anchored to a button that
      // no longer exists.
      setMoreOpen(false)
    }
    measure(pane.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined) measure(width)
    })
    observer.observe(pane)
    return () => observer.disconnect()
  }, [])

  /* ---------- multi-line paste warning (NFR-14) ---------- */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const pasteText = (text: string): void => {
      if (warnOnMultilinePaste && text.includes('\n')) {
        setPendingPaste(text)
        return
      }
      acquireTerminal(config.id, { scrollback, onOutput: () => {} }).term.paste(text)
    }
    const onPaste = (event: ClipboardEvent): void => {
      const text = event.clipboardData?.getData('text') ?? ''
      if (!warnOnMultilinePaste || !text.includes('\n')) return
      event.preventDefault()
      event.stopPropagation()
      setPendingPaste(text)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const ctrl = event.ctrlKey || event.metaKey
      if (!ctrl || event.altKey) return

      const key = event.key.toLowerCase()
      const terminal = acquireTerminal(config.id, { scrollback, onOutput: () => {} }).term

      // Preserve Ctrl+C as the shell interrupt unless the user has selected
      // terminal output, in which case it follows the normal copy convention.
      if (key === 'c' && !event.shiftKey && terminal.hasSelection()) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {})
        return
      }

      if (key === 'v' && !event.shiftKey) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void navigator.clipboard.readText().then(pasteText).catch(() => {})
      }
    }
    host.addEventListener('paste', onPaste, true)
    host.addEventListener('keydown', onKeyDown, true)
    return () => {
      host.removeEventListener('paste', onPaste, true)
      host.removeEventListener('keydown', onKeyDown, true)
    }
  }, [config.id, scrollback, warnOnMultilinePaste])

  const handleRestart = useCallback(() => {
    const entry = acquireTerminal(config.id, { scrollback, onOutput: () => {} })
    entry.term.clear()
    void restartTerminal(config.id, entry.term.cols, entry.term.rows)
  }, [config.id, restartTerminal, scrollback])

  const handleClose = useCallback(() => {
    requestTerminalClose(config.id)
  }, [config.id, requestTerminalClose])

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

  /* ---------- drag a pane onto another pane ---------- */
  const readDragSource = (event: React.DragEvent): string | null => {
    const id = event.dataTransfer.getData(TERMINAL_DRAG_TYPE)
    // Firefox/Chromium hide the payload during dragover, so an in-flight drag
    // is recognised by its custom type alone and read for real on drop.
    if (id) return id
    return event.dataTransfer.types.includes(TERMINAL_DRAG_TYPE) ? '' : null
  }

  const positionFor = (event: React.DragEvent<HTMLElement>): DropPosition => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    // The middle third means "trade places"; the edges mean "sit beside me".
    if (x > 0.33 && x < 0.67 && y > 0.33 && y < 0.67) return 'swap'
    const fromEdge = Math.min(x, 1 - x) < Math.min(y, 1 - y)
    if (fromEdge) return x < 0.5 ? 'left' : 'right'
    return y < 0.5 ? 'top' : 'bottom'
  }

  const onDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (readDragSource(event) === null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropPosition(positionFor(event))
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const sourceId = readDragSource(event)
      setDropPosition(null)
      if (!sourceId || sourceId === config.id) return
      event.preventDefault()
      void moveTerminalTo(sourceId, config.id, positionFor(event))
    },
    [config.id, moveTerminalTo]
  )

  const clearScreen = useCallback(() => {
    const entry = acquireTerminal(config.id, { scrollback, onOutput: () => {} })
    entry.term.clear()
    entry.term.focus()
  }, [config.id, scrollback])

  return (
    <section
      ref={paneRef}
      className={`pane ${isActive ? 'pane--active' : ''} ${compact ? 'pane--compact' : ''}`}
      aria-label={`Terminal ${config.title}`}
      onMouseDown={() => focusTerminal(config.id)}
      onDragOver={onDragOver}
      onDragLeave={() => setDropPosition(null)}
      onDrop={onDrop}
    >
      {/*
        The whole header is the drag handle. Limiting it to the title made the
        gesture almost undiscoverable: the obvious places to grab a pane are its
        header bar and its body, and neither did anything.
      */}
      <header
        className="pane__header"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(TERMINAL_DRAG_TYPE, config.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => setDropPosition(null)}
      >
        <span className="pane__grip" aria-hidden="true" title="Drag to move this pane">
          <DotsSixVerticalIcon size={15} weight="bold" />
        </span>
        <div className="pane__identity">
          <span
            className="pane__title"
            onDoubleClick={() => setRenaming(true)}
            title={`${config.title} — drag the header to move, double-click to rename`}
          >
            {config.title}
          </span>
          <StatusBadge {...(session ? { session } : {})} />
        </div>
        {/* cwd, branch and elapsed are the first things to go: they are context,
            not controls, and the pane header still shows them on hover titles. */}
        {!compact && (
        <div className="pane__metadata">
          <span className="pane__cwd" title={config.cwd}>
            cwd: {workspace ? relativeWorkspacePath(workspace.projectRoot, config.cwd) : config.cwd}
          </span>
          {git && (
            <span
              className={`pane__branch ${git.detached ? 'pane__branch--detached' : ''}`}
              title={
                git.detached
                  ? `Detached HEAD at ${git.branch} — ${git.root}`
                  : `On branch ${git.branch} — ${git.root}`
              }
            >
              <GitBranchIcon size={13} weight="bold" aria-hidden />
              <span className="pane__branch-name">{git.branch}</span>
            </span>
          )}
          <span>{formatSessionElapsed(session)}</span>
          {hasUnread && <span className="pane__new-output">New output</span>}
        </div>
        )}
        {compact && hasUnread && <span className="pane__new-output">New output</span>}
        {/* draggable=false stops a press on a button from starting a pane drag. */}
        <div className="pane__actions" draggable={false}>
          {!compact && (
            <>
              <button
                type="button"
                className="icon-button"
                onClick={() => void detachTerminal(config.id)}
                aria-label="Open in new window"
                title="Show this session in its own window"
              >
                <ArrowSquareOutIcon size={17} />
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
            </>
          )}
          <div className="pane__more">
            <button
              type="button"
              className="icon-button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-controls={`pane-menu-${config.id}`}
              aria-label={compact ? 'Session menu' : 'More session actions'}
              title={compact ? 'Session actions' : 'More session actions'}
            >
              {compact ? <ListIcon size={18} /> : <DotsThreeVerticalIcon size={18} />}
            </button>
            {moreOpen && (
              <div className="pane__menu" role="menu" id={`pane-menu-${config.id}`}>
                {/*
                  Narrow panes fold every action in here rather than letting the
                  icon row overlap the title, so nothing becomes unreachable
                  just because the window got small.
                */}
                {compact && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setMoreOpen(false); void detachTerminal(config.id) }}
                    >
                      Open in new window
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); handleRestart() }}>
                      {session ? 'Restart' : 'Start'}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!isRunning}
                      onClick={() => { setMoreOpen(false); void stopTerminal(config.id) }}
                    >
                      Stop
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); toggleZoom(config.id) }}>
                      Zoom pane
                    </button>
                  </>
                )}
                <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setRenaming(true) }}>
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMoreOpen(false); setSearchOpen((open) => !open) }}
                >
                  Find in terminal
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
                  onClick={() => { setMoreOpen(false); handleClose() }}
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

      {dropPosition && (
        <div className={`pane__drop pane__drop--${dropPosition}`} aria-hidden="true">
          <span className="pane__drop-label">{DROP_LABELS[dropPosition]}</span>
        </div>
      )}

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
            acquireTerminal(config.id, { scrollback, onOutput: () => {} }).term.paste(text)
          }}
        />
      )}

      {renaming && <RenameTerminalDialog terminal={config} onClose={() => setRenaming(false)} />}

    </section>
  )
}
