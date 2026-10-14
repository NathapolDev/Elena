/**
 * Renders the layout tree. Dividers are draggable and the resulting ratio is
 * pushed straight to the store; persistence is debounced in the main process.
 */
import { useCallback, useEffect, useRef } from 'react'
import type { LayoutNode, TerminalConfig } from '@shared/types'
import { clampRatio, collectTerminalIds } from '@shared/layout'
import { TerminalPane } from './TerminalPane'
import { DetachedPanePlaceholder } from './DetachedPanePlaceholder'

type Props = {
  node: LayoutNode
  terminals: TerminalConfig[]
  activeTerminalId: string | null
  detachedTerminalIds: string[]
  chrome?: 'full' | 'minimal'
  searchTerminalId?: string | null
  onSearchClose?: () => void
  path?: number[]
  onRatioChange: (path: number[], ratio: number) => void
  onActivateTab: (tabId: string) => void
}

export function SplitView({
  node,
  terminals,
  activeTerminalId,
  detachedTerminalIds,
  path = [],
  chrome = 'full',
  searchTerminalId,
  onSearchClose,
  onRatioChange,
  onActivateTab
}: Props): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null)
  const finishDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => finishDrag.current?.(), [])

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (node.type !== 'split') return
      const container = containerRef.current
      if (!container) return
      finishDrag.current?.()
      event.preventDefault()
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)

      let frame: number | null = null
      let point: { x: number; y: number } | null = null
      const commit = (): void => {
        frame = null
        if (!point || !container.isConnected) return
        const rect = container.getBoundingClientRect()
        const ratio =
          node.direction === 'horizontal'
            ? (point.x - rect.left) / rect.width
            : (point.y - rect.top) / rect.height
        onRatioChange(path, clampRatio(ratio))
      }
      // Up to 1000 pointer events/s × one visible split × two panes. Keep
      // geometry reads and local React updates to one per animation frame.
      const move = (moveEvent: PointerEvent): void => {
        point = { x: moveEvent.clientX, y: moveEvent.clientY }
        frame ??= requestAnimationFrame(commit)
      }
      const up = (): void => {
        if (frame !== null) cancelAnimationFrame(frame)
        commit()
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        finishDrag.current = null
      }
      finishDrag.current = up
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [node, onRatioChange, path]
  )

  if (node.type === 'terminal') {
    const config = terminals.find((t) => t.id === node.terminalId)
    if (!config) return null
    // The leaf stays in the tree while the terminal lives in its own window, so
    // detaching never touches the persisted layout and reattaching is exact.
    if (detachedTerminalIds.includes(node.terminalId)) {
      return <DetachedPanePlaceholder config={config} />
    }
    return <TerminalPane config={config} isActive={activeTerminalId === node.terminalId} chrome={chrome}
      searchVisible={searchTerminalId === undefined ? undefined : searchTerminalId === config.id} onSearchClose={onSearchClose} />
  }

  if (node.type === 'tabs') {
    const activeIndex = Math.max(0, node.tabs.findIndex((tab) => tab.id === node.activeTabId))
    const active = node.tabs[activeIndex]
    const isSpatialGrid = node.tabs.every((tab) => tab.id.startsWith('grid-page-'))
    if (!active) return null
    return (
      <div className={`tabs ${isSpatialGrid ? 'tabs--spatial-grid' : ''}`}>
        {!isSpatialGrid && (
          <div className="tabs__bar" role="tablist" aria-label="Terminal tabs">
            {node.tabs.map((tab, index) => {
              const terminalId = collectTerminalIds(tab.layout)[0]
              const title = terminals.find((terminal) => terminal.id === terminalId)?.title ?? `Terminal ${index + 1}`
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  className="tabs__tab"
                  aria-selected={tab.id === node.activeTabId}
                  onClick={() => onActivateTab(tab.id)}
                >
                  {index + 1}. {title}
                </button>
              )
            })}
          </div>
        )}
        <div className="tabs__content" role="tabpanel">
          <SplitView
            chrome={chrome} searchTerminalId={searchTerminalId} onSearchClose={onSearchClose}
            node={active.layout}
            terminals={terminals}
            activeTerminalId={activeTerminalId}
            detachedTerminalIds={detachedTerminalIds}
            path={[...path, activeIndex]}
            onRatioChange={onRatioChange}
            onActivateTab={onActivateTab}
          />
        </div>
      </div>
    )
  }

  const first = `${node.ratio * 100}%`
  const second = `${(1 - node.ratio) * 100}%`

  return (
    <div className={`split split--${node.direction}`} ref={containerRef}>
      <div
        className="split__child"
        style={node.direction === 'horizontal' ? { width: first } : { height: first }}
      >
        <SplitView
          chrome={chrome} searchTerminalId={searchTerminalId} onSearchClose={onSearchClose}
          node={node.children[0]}
          terminals={terminals}
          activeTerminalId={activeTerminalId}
          detachedTerminalIds={detachedTerminalIds}
          path={[...path, 0]}
          onRatioChange={onRatioChange}
          onActivateTab={onActivateTab}
        />
      </div>
      <div
        className="split__divider"
        role="separator"
        tabIndex={0}
        aria-orientation={node.direction === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-label="Resize panes"
        aria-valuenow={Math.round(node.ratio * 100)}
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          // Keyboard resize keeps NFR-22 true for split management.
          const step = event.shiftKey ? 0.1 : 0.02
          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault()
            onRatioChange(path, clampRatio(node.ratio - step))
          }
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault()
            onRatioChange(path, clampRatio(node.ratio + step))
          }
        }}
      />
      <div
        className="split__child"
        style={node.direction === 'horizontal' ? { width: second } : { height: second }}
      >
        <SplitView
          chrome={chrome} searchTerminalId={searchTerminalId} onSearchClose={onSearchClose}
          node={node.children[1]}
          terminals={terminals}
          activeTerminalId={activeTerminalId}
          detachedTerminalIds={detachedTerminalIds}
          path={[...path, 1]}
          onRatioChange={onRatioChange}
          onActivateTab={onActivateTab}
        />
      </div>
    </div>
  )
}
