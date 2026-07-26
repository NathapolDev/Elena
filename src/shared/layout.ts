/**
 * Pure layout-tree operations. No Electron, no DOM — so the split/close/resize
 * rules are unit testable on their own (Testing strategy: layout tree
 * operations and ratio constraints).
 */
import type { LayoutNode } from './types'

export const MIN_RATIO = 0.1
export const MAX_RATIO = 0.9

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio))
}

export function collectTerminalIds(node: LayoutNode | null): string[] {
  if (!node) return []
  if (node.type === 'terminal') return [node.terminalId]
  if (node.type === 'tabs') return node.tabs.flatMap((tab) => collectTerminalIds(tab.layout))
  return [...collectTerminalIds(node.children[0]), ...collectTerminalIds(node.children[1])]
}

export function containsTerminal(node: LayoutNode | null, terminalId: string): boolean {
  return collectTerminalIds(node).includes(terminalId)
}

const GRID_PAGE_SIZE = 4

/**
 * Builds the Spatial Agent Grid without changing the persisted layout schema.
 * Up to four terminals share one balanced page; additional terminals become
 * persisted grid pages backed by the existing tabs node.
 */
export function buildSpatialGrid(terminalIds: readonly string[], activeTerminalId?: string): LayoutNode | null {
  const ids = [...new Set(terminalIds.filter(Boolean))]
  if (ids.length === 0) return null

  const pages: Array<{ id: string; layout: LayoutNode }> = []
  for (let index = 0; index < ids.length; index += GRID_PAGE_SIZE) {
    const pageIds = ids.slice(index, index + GRID_PAGE_SIZE)
    pages.push({ id: `grid-page-${index / GRID_PAGE_SIZE + 1}`, layout: buildGridPage(pageIds) })
  }

  if (pages.length === 1) return pages[0]!.layout

  const activePage = activeTerminalId
    ? pages.find((page) => containsTerminal(page.layout, activeTerminalId))
    : undefined
  return {
    type: 'tabs',
    activeTabId: activePage?.id ?? pages[pages.length - 1]!.id,
    tabs: pages
  }
}

function buildGridPage(ids: string[]): LayoutNode {
  const leaves = ids.map<LayoutNode>((terminalId) => ({ type: 'terminal', terminalId }))
  if (leaves.length === 1) return leaves[0]!
  if (leaves.length === 2) return splitPair(leaves[0]!, leaves[1]!, 'horizontal')
  if (leaves.length === 3) {
    return splitPair(leaves[0]!, splitPair(leaves[1]!, leaves[2]!, 'vertical'), 'horizontal')
  }
  return splitPair(
    splitPair(leaves[0]!, leaves[2]!, 'vertical'),
    splitPair(leaves[1]!, leaves[3]!, 'vertical'),
    'horizontal'
  )
}

function splitPair(first: LayoutNode, second: LayoutNode, direction: 'horizontal' | 'vertical'): LayoutNode {
  return { type: 'split', direction, ratio: 0.5, children: [first, second] }
}

/** Replaces `targetId`'s leaf with a split holding the target and the new terminal. */
export function splitTerminal(
  root: LayoutNode | null,
  targetId: string,
  newTerminalId: string,
  direction: 'horizontal' | 'vertical'
): LayoutNode {
  const leaf: LayoutNode = { type: 'terminal', terminalId: newTerminalId }
  if (!root) return leaf

  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === 'terminal') {
      if (node.terminalId !== targetId) return node
      return {
        type: 'split',
        direction,
        ratio: 0.5,
        children: [node, leaf]
      }
    }
    if (node.type === 'tabs') {
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, layout: replace(tab.layout) })) }
    }
    return {
      ...node,
      children: [replace(node.children[0]), replace(node.children[1])]
    }
  }

  const next = replace(root)
  // Target was not in the tree: attach the new terminal at the root instead of
  // silently dropping it.
  if (!containsTerminal(next, newTerminalId)) {
    return { type: 'split', direction, ratio: 0.5, children: [root, leaf] }
  }
  return next
}

/** Removes a leaf and collapses the parent split into its surviving sibling. */
export function removeTerminal(root: LayoutNode | null, terminalId: string): LayoutNode | null {
  if (!root) return null
  if (root.type === 'terminal') return root.terminalId === terminalId ? null : root

  if (root.type === 'tabs') {
    const tabs = root.tabs.flatMap((tab) => {
      const layout = removeTerminal(tab.layout, terminalId)
      return layout ? [{ ...tab, layout }] : []
    })
    if (tabs.length === 0) return null
    if (tabs.length === 1) return tabs[0]!.layout
    return {
      ...root,
      tabs,
      activeTabId: tabs.some((tab) => tab.id === root.activeTabId) ? root.activeTabId : tabs[0]!.id
    }
  }

  const left = removeTerminal(root.children[0], terminalId)
  const right = removeTerminal(root.children[1], terminalId)
  if (left && right) return { ...root, children: [left, right] }
  return left ?? right
}

export function setRatio(root: LayoutNode | null, path: number[], ratio: number): LayoutNode | null {
  if (!root) return null
  if (path.length === 0) {
    if (root.type !== 'split') return root
    return { ...root, ratio: clampRatio(ratio) }
  }
  if (root.type === 'tabs') {
    const [head, ...rest] = path
    const index = Math.max(0, Math.min(root.tabs.length - 1, head ?? 0))
    return {
      ...root,
      tabs: root.tabs.map((tab, tabIndex) =>
        tabIndex === index ? { ...tab, layout: setRatio(tab.layout, rest, ratio) ?? tab.layout } : tab
      )
    }
  }
  if (root.type !== 'split') return root
  const [head, ...rest] = path
  const index = head === 1 ? 1 : 0
  const updated = setRatio(root.children[index], rest, ratio)
  if (!updated) return root
  const children: [LayoutNode, LayoutNode] =
    index === 0 ? [updated, root.children[1]] : [root.children[0], updated]
  return { ...root, children }
}

/** Appends a terminal as a new persisted tab. */
export function appendTerminal(
  root: LayoutNode | null,
  terminalId: string
): LayoutNode {
  const leaf: LayoutNode = { type: 'terminal', terminalId }
  if (!root) return leaf
  if (root.type === 'tabs') {
    return { ...root, activeTabId: terminalId, tabs: [...root.tabs, { id: terminalId, layout: leaf }] }
  }
  const firstId = collectTerminalIds(root)[0] ?? terminalId
  return {
    type: 'tabs',
    activeTabId: terminalId,
    tabs: [
      { id: `tab-${firstId}`, layout: root },
      { id: terminalId, layout: leaf }
    ]
  }
}

export function activateTab(root: LayoutNode | null, tabId: string): LayoutNode | null {
  if (!root || root.type !== 'tabs' || !root.tabs.some((tab) => tab.id === tabId)) return root
  return { ...root, activeTabId: tabId }
}

/** Drops leaves whose terminal no longer exists, so a corrupt file cannot render a ghost pane. */
export function pruneLayout(root: LayoutNode | null, knownIds: readonly string[]): LayoutNode | null {
  if (!root) return null
  const known = new Set(knownIds)
  const prune = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'terminal') return known.has(node.terminalId) ? node : null
    if (node.type === 'tabs') {
      const tabs = node.tabs.flatMap((tab) => {
        const layout = prune(tab.layout)
        return layout ? [{ ...tab, layout }] : []
      })
      if (tabs.length === 0) return null
      if (tabs.length === 1) return tabs[0]!.layout
      return {
        ...node,
        tabs,
        activeTabId: tabs.some((tab) => tab.id === node.activeTabId) ? node.activeTabId : tabs[0]!.id
      }
    }
    const left = prune(node.children[0])
    const right = prune(node.children[1])
    if (left && right) return { ...node, children: [left, right] }
    return left ?? right
  }
  return prune(root)
}
