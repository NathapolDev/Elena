/**
 * Workspaces and sessions rail.
 *
 * Every workspace is listed at once — selecting one is a click on a visible
 * row, not a dropdown that hides the rest. The rail is resizable by dragging
 * (or arrow-keying) its right edge and can be hidden entirely; both are chrome
 * preferences owned by App and persisted in `uiPrefs`.
 */
import { useCallback } from 'react'
import { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft'
import { CircleIcon } from '@phosphor-icons/react/Circle'
import { FolderIcon } from '@phosphor-icons/react/Folder'
import { PencilSimpleIcon } from '@phosphor-icons/react/PencilSimple'
import { PlusIcon } from '@phosphor-icons/react/Plus'
import { TrashIcon } from '@phosphor-icons/react/Trash'
import { collectTerminalIds } from '@shared/layout'
import { useStore } from '../state/store'
import { StatusBadge } from './StatusBadge'
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth } from '../lib/uiPrefs'
import type { Workspace } from '@shared/types'

type Props = {
  workspace: Workspace | undefined
  width: number
  onWidthChange: (width: number) => void
  onHide: () => void
  onNewWorkspace: () => void
  onNewTerminal: () => void
  onRenameWorkspace: () => void
  onDeleteWorkspace: () => void
}

export function Sidebar({
  workspace,
  width,
  onWidthChange,
  onHide,
  onNewWorkspace,
  onNewTerminal,
  onRenameWorkspace,
  onDeleteWorkspace
}: Props): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const activeTerminalId = useStore((s) => s.activeTerminalId)
  const sessions = useStore((s) => s.sessions)
  const unread = useStore((s) => s.unread)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const focusTerminal = useStore((s) => s.focusTerminal)
  const toggleZoom = useStore((s) => s.toggleZoom)
  const activateTab = useStore((s) => s.activateTab)

  const layout = workspace?.layout ?? null
  const gridPages =
    layout?.type === 'tabs' && layout.tabs.every((tab) => tab.id.startsWith('grid-page-')) ? layout : null

  // Every range is derived from what a page actually holds: closing a terminal
  // shrinks a page in place without rebalancing, and a layout grown by
  // splitting is not capped at four either. A `tabs` layout that is not a grid
  // has no pages to describe, so it gets no buttons rather than a misleading one.
  type GridPageRange = { id: string; start: number; end: number; selected: boolean }
  const gridPageRanges: GridPageRange[] = gridPages
    ? gridPages.tabs.reduce<GridPageRange[]>((ranges, tab) => {
        const start = (ranges[ranges.length - 1]?.end ?? 0) + 1
        return [
          ...ranges,
          {
            id: tab.id,
            start,
            end: start + collectTerminalIds(tab.layout).length - 1,
            selected: tab.id === gridPages.activeTabId
          }
        ]
      }, [])
    : layout && layout.type !== 'tabs'
      ? [{ id: 'grid-page-1', start: 1, end: collectTerminalIds(layout).length, selected: true }]
      : []

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const rail = event.currentTarget.parentElement
      const left = rail ? rail.getBoundingClientRect().left : 0
      event.currentTarget.setPointerCapture(event.pointerId)
      document.body.classList.add('is-resizing')

      const move = (moveEvent: PointerEvent): void => onWidthChange(clampSidebarWidth(moveEvent.clientX - left))
      const up = (): void => {
        document.body.classList.remove('is-resizing')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [onWidthChange]
  )

  return (
    <nav className="sidebar" id="sidebar" aria-label="Workspaces and sessions">
      <section className="sidebar__group sidebar__group--workspaces">
        <div className="sidebar__header">
          <h2 className="sidebar__label" id="workspace-list-label">
            Workspaces
          </h2>
          <button
            type="button"
            className="button button--icon"
            onClick={onNewWorkspace}
            title="New workspace (Ctrl+Shift+N)"
            aria-label="New workspace"
          >
            <PlusIcon size={17} />
          </button>
          <button
            type="button"
            className="button button--icon"
            onClick={onHide}
            title="Hide sidebar (Ctrl+B)"
            aria-label="Hide sidebar"
          >
            <CaretLeftIcon size={17} />
          </button>
        </div>

        <ul className="sidebar__scroll" aria-labelledby="workspace-list-label">
          {workspaces.length === 0 && <li className="sidebar__empty">No workspaces yet.</li>}
          {workspaces.map((item) => {
            const ids = collectTerminalIds(item.layout)
            const running = ids.filter((id) => sessions[id]?.status === 'running').length
            const hasNewOutput = ids.some((id) => unread[id])
            const isActive = item.id === activeWorkspaceId
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`workspace-item ${isActive ? 'workspace-item--active' : ''}`}
                  onClick={() => selectWorkspace(item.id)}
                  aria-current={isActive}
                >
                  <span className="workspace-item__icon" aria-hidden="true">
                    <FolderIcon size={20} weight={isActive ? 'fill' : 'regular'} />
                  </span>
                  <span className="workspace-item__text">
                    <span className="workspace-item__name">{item.name}</span>
                    <span className="workspace-item__meta" title={item.projectRoot}>
                      {ids.length} session{ids.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <CircleIcon
                    className={`workspace-item__indicator ${
                      hasNewOutput ? 'workspace-item__indicator--unread' : running > 0 ? 'workspace-item__indicator--running' : ''
                    }`}
                    size={9}
                    weight="fill"
                    aria-label={hasNewOutput ? 'New output' : running > 0 ? `${running} running` : 'Idle'}
                  />
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="sidebar__group sidebar__group--sessions">
        <div className="sidebar__header">
          <h2 className="sidebar__label" id="session-list-label">
            Sessions · {workspace?.name ?? 'No workspace'}
          </h2>
          <button
            type="button"
            className="button button--icon"
            onClick={onNewTerminal}
            disabled={!workspace}
            title="New terminal (Ctrl+T)"
            aria-label="New terminal"
          >
            <PlusIcon size={17} />
          </button>
        </div>

        <ul className="sidebar__scroll" aria-labelledby="session-list-label">
          {(workspace?.terminals ?? []).map((terminal) => (
            <li key={terminal.id}>
              <button
                type="button"
                className={`session-item ${activeTerminalId === terminal.id ? 'session-item--active' : ''}`}
                onClick={() => focusTerminal(terminal.id)}
                onDoubleClick={() => toggleZoom(terminal.id)}
                aria-current={activeTerminalId === terminal.id}
              >
                <span className="session-item__text">
                  <span className="session-item__title">{terminal.title}</span>
                  <span className="session-item__meta">
                    <StatusBadge {...(sessions[terminal.id] ? { session: sessions[terminal.id]! } : {})} />
                  </span>
                </span>
                {unread[terminal.id] && (
                  <span className="session-item__new-output">New</span>
                )}
              </button>
            </li>
          ))}
          {workspace && workspace.terminals.length === 0 && (
            <li className="sidebar__empty">No sessions yet. Use New Terminal to start one.</li>
          )}
          {!workspace && <li className="sidebar__empty">Select a workspace to see its sessions.</li>}
        </ul>
      </section>

      {workspace && (
        <div className="sidebar__footer">
          <button type="button" className="button sidebar__new-session" onClick={onNewTerminal} aria-label="New Terminal">
            <PlusIcon size={17} /> New session
          </button>
          {gridPageRanges.length > 0 && (
            <div className="grid-pages" aria-label="Grid pages">
              <span className="sidebar__label">Grid pages</span>
              <div className="grid-pages__buttons" role="tablist" aria-label="Spatial grid pages">
                {gridPageRanges.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    role="tab"
                    className="grid-page-button"
                    aria-selected={page.selected}
                    onClick={() => activateTab(page.id)}
                  >
                    {page.start}–{page.end}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="sidebar__footer-actions">
            <button
              type="button"
              className="button"
              onClick={onRenameWorkspace}
              aria-label="Rename workspace"
              title={`Rename "${workspace.name}"`}
            >
              <PencilSimpleIcon size={16} /> Rename
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={onDeleteWorkspace}
              aria-label="Delete workspace"
              title={`Delete "${workspace.name}"`}
            >
              <TrashIcon size={16} /> Delete
            </button>
          </div>
        </div>
      )}

      <div
        className="sidebar__resizer"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        onPointerDown={startResize}
        onDoubleClick={() => onWidthChange(SIDEBAR_DEFAULT_WIDTH)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 8
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            onWidthChange(clampSidebarWidth(width - step))
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            onWidthChange(clampSidebarWidth(width + step))
          }
        }}
      />
    </nav>
  )
}
