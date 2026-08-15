import { describe, expect, it } from 'vitest'
import {
  appendTerminal,
  activateTab,
  buildSpatialGrid,
  clampRatio,
  collectTerminalIds,
  moveTerminal,
  pruneLayout,
  removeTerminal,
  setRatio,
  splitTerminal
} from '@shared/layout'
import type { LayoutNode } from '@shared/types'

const leaf = (id: string): LayoutNode => ({ type: 'terminal', terminalId: id })

describe('clampRatio', () => {
  it('keeps a pane from collapsing to nothing', () => {
    expect(clampRatio(0)).toBe(0.1)
    expect(clampRatio(1)).toBe(0.9)
    expect(clampRatio(0.42)).toBe(0.42)
  })

  it('falls back to an even split for non-finite input', () => {
    expect(clampRatio(Number.NaN)).toBe(0.5)
  })
})

describe('splitTerminal', () => {
  it('creates the first leaf when the tree is empty', () => {
    expect(splitTerminal(null, 'missing', 'a', 'horizontal')).toEqual(leaf('a'))
  })

  it('replaces the target leaf with a split of target and new terminal', () => {
    const tree = splitTerminal(leaf('a'), 'a', 'b', 'horizontal')
    expect(tree).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [leaf('a'), leaf('b')]
    })
  })

  it('splits a nested leaf without disturbing its siblings', () => {
    const tree = splitTerminal(splitTerminal(leaf('a'), 'a', 'b', 'horizontal'), 'b', 'c', 'vertical')
    expect(collectTerminalIds(tree)).toEqual(['a', 'b', 'c'])
  })

  it('attaches at the root rather than dropping the terminal when the target is gone', () => {
    const tree = splitTerminal(leaf('a'), 'ghost', 'b', 'horizontal')
    expect(collectTerminalIds(tree)).toEqual(['a', 'b'])
  })
})

describe('removeTerminal', () => {
  it('collapses the parent split into the surviving sibling', () => {
    const tree = splitTerminal(leaf('a'), 'a', 'b', 'horizontal')
    expect(removeTerminal(tree, 'b')).toEqual(leaf('a'))
  })

  it('returns null when the last terminal goes', () => {
    expect(removeTerminal(leaf('a'), 'a')).toBeNull()
  })

  it('keeps the rest of a three-pane tree intact', () => {
    const tree = splitTerminal(splitTerminal(leaf('a'), 'a', 'b', 'horizontal'), 'b', 'c', 'vertical')
    expect(collectTerminalIds(removeTerminal(tree, 'b'))).toEqual(['a', 'c'])
  })
})

describe('moveTerminal', () => {
  const threePane = (): LayoutNode =>
    splitTerminal(splitTerminal(leaf('a'), 'a', 'b', 'horizontal'), 'b', 'c', 'vertical')

  it('swaps two leaves without disturbing the surrounding structure', () => {
    const tree = threePane()
    const moved = moveTerminal(tree, 'a', 'c', 'swap')
    expect(collectTerminalIds(moved)).toEqual(['c', 'b', 'a'])
    // Same shape, different occupants: ratios and split directions survive.
    expect(shapeOf(moved)).toEqual(shapeOf(tree))
  })

  it('drops the source beside the target in the requested direction', () => {
    const moved = moveTerminal(threePane(), 'c', 'a', 'right')
    expect(collectTerminalIds(moved)).toEqual(['a', 'c', 'b'])
    expect(moved?.type === 'split' && moved.children[0]).toEqual({
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [leaf('a'), leaf('c')]
    })
  })

  it('puts the source first for a left or top drop', () => {
    const moved = moveTerminal(threePane(), 'c', 'a', 'top')
    expect(moved?.type === 'split' && moved.children[0]).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [leaf('c'), leaf('a')]
    })
  })

  it('never loses or duplicates a terminal', () => {
    const tree = buildSpatialGrid(['a', 'b', 'c', 'd', 'e', 'f'], 'a')
    const before = collectTerminalIds(tree)
    for (const position of ['left', 'right', 'top', 'bottom', 'swap'] as const) {
      const moved = moveTerminal(tree, 'f', 'a', position)
      expect([...collectTerminalIds(moved)].sort()).toEqual([...before].sort())
    }
  })

  it('moves a terminal out of one grid page and into another', () => {
    const tree = buildSpatialGrid(['a', 'b', 'c', 'd', 'e'], 'a')
    const moved = moveTerminal(tree, 'e', 'a', 'right')
    // The emptied page collapses, so the tabs node unwraps to a single page.
    expect(moved?.type).toBe('split')
    expect([...collectTerminalIds(moved)].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('leaves the tree untouched for a no-op or unknown terminal', () => {
    const tree = threePane()
    expect(moveTerminal(tree, 'a', 'a', 'left')).toBe(tree)
    expect(moveTerminal(tree, 'ghost', 'a', 'left')).toBe(tree)
    expect(moveTerminal(tree, 'a', 'ghost', 'left')).toBe(tree)
    expect(moveTerminal(null, 'a', 'b', 'left')).toBeNull()
  })
})

/** Structure without occupants, so a swap can be checked for shape preservation. */
function shapeOf(node: LayoutNode | null): unknown {
  if (!node) return null
  if (node.type === 'terminal') return 'terminal'
  if (node.type === 'tabs') return { tabs: node.tabs.map((tab) => shapeOf(tab.layout)) }
  return { direction: node.direction, ratio: node.ratio, children: node.children.map(shapeOf) }
}

describe('setRatio', () => {
  it('updates the addressed split and clamps the value', () => {
    const tree = splitTerminal(leaf('a'), 'a', 'b', 'horizontal')
    const updated = setRatio(tree, [], 0.99)
    expect(updated?.type === 'split' && updated.ratio).toBe(0.9)
  })

  it('reaches a nested split by path', () => {
    const tree = splitTerminal(splitTerminal(leaf('a'), 'a', 'b', 'horizontal'), 'b', 'c', 'vertical')
    const updated = setRatio(tree, [1], 0.3)
    const child = updated?.type === 'split' ? updated.children[1] : null
    expect(child?.type === 'split' && child.ratio).toBe(0.3)
  })
})

describe('pruneLayout', () => {
  it('drops leaves whose terminal no longer exists', () => {
    const tree = splitTerminal(leaf('a'), 'a', 'b', 'horizontal')
    expect(pruneLayout(tree, ['a'])).toEqual(leaf('a'))
  })

  it('returns null when nothing survives', () => {
    expect(pruneLayout(leaf('a'), [])).toBeNull()
  })
})

describe('appendTerminal', () => {
  it('adds to an empty layout as the root leaf', () => {
    expect(appendTerminal(null, 'a')).toEqual(leaf('a'))
  })

  it('appends after the last terminal', () => {
    const tree = appendTerminal(appendTerminal(null, 'a'), 'b')
    expect(collectTerminalIds(tree)).toEqual(['a', 'b'])
    expect(tree.type).toBe('tabs')
    expect(tree.type === 'tabs' && tree.activeTabId).toBe('b')
  })

  it('persists the active tab', () => {
    const tree = appendTerminal(appendTerminal(null, 'a'), 'b')
    const firstTab = tree.type === 'tabs' ? tree.tabs[0]!.id : ''
    const updated = activateTab(tree, firstTab)
    expect(updated?.type === 'tabs' && updated.activeTabId).toBe(firstTab)
  })
})

describe('buildSpatialGrid', () => {
  it('builds a balanced two-by-two page', () => {
    const tree = buildSpatialGrid(['a', 'b', 'c', 'd'])
    expect(tree?.type).toBe('split')
    expect(collectTerminalIds(tree)).toEqual(['a', 'c', 'b', 'd'])
    expect(tree?.type === 'split' && tree.direction).toBe('horizontal')
    expect(tree?.type === 'split' && tree.children.every((child) => child.type === 'split')).toBe(true)
  })

  it('creates persisted grid pages after four terminals', () => {
    const tree = buildSpatialGrid(['a', 'b', 'c', 'd', 'e', 'f'], 'f')
    expect(tree?.type).toBe('tabs')
    expect(tree?.type === 'tabs' && tree.tabs).toHaveLength(2)
    expect(tree?.type === 'tabs' && tree.activeTabId).toBe('grid-page-2')
    expect(collectTerminalIds(tree)).toEqual(['a', 'c', 'b', 'd', 'e', 'f'])
  })

  it('deduplicates ids and handles an empty workspace', () => {
    expect(buildSpatialGrid([])).toBeNull()
    expect(collectTerminalIds(buildSpatialGrid(['a', 'a', 'b']))).toEqual(['a', 'b'])
  })
})
