/**
 * Guard suite: the three renderer rules that were previously enforced only by
 * file-header comments.
 *
 * These are deliberately crude call-site counts over the source. They cannot
 * prove correctness, but each one catches the specific edit an agent or a
 * hurried human actually makes, and none of them has any other mechanism.
 *
 * A failure here means an invariant was broken, not that the test is stale.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = join(process.cwd(), 'src/renderer/src')

type SourceFile = { path: string; label: string; source: string }

function collect(dir: string, extensions: readonly string[]): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collect(full, extensions)
    if (!extensions.some((extension) => entry.name.endsWith(extension))) return []
    return [
      {
        path: full,
        label: relative(process.cwd(), full).replaceAll('\\', '/'),
        source: readFileSync(full, 'utf8')
      }
    ]
  })
}

const sources = collect(RENDERER, ['.ts', '.tsx'])

function callSites(pattern: RegExp): string[] {
  return sources.flatMap(({ label, source }) =>
    [...source.matchAll(pattern)].map(() => label)
  )
}

describe('terminal:data fan-out', () => {
  it('is subscribed exactly once, in App.tsx', () => {
    // lib/terminalBus.ts is the fan-out. A per-pane subscription duplicates
    // every chunk across panes and breaks the pre-mount backlog.
    const sites = callSites(/subscribe\(\s*'terminal:data'|on\(\s*'terminal:data'/g)
    expect(sites).toEqual(['src/renderer/src/App.tsx'])
  })
})

describe('xterm lifetime', () => {
  it('releases terminals from exactly one place, state/store.ts', () => {
    // Adding a release on TerminalPane unmount destroys scrollback on every
    // split, zoom, tab switch and StrictMode double-mount.
    const sites = callSites(/\breleaseTerminal\(/g).filter(
      (label) => label !== 'src/renderer/src/lib/terminalRegistry.ts'
    )
    expect(sites).toEqual(['src/renderer/src/state/store.ts'])
  })

  it('disposes xterm instances only inside the registry', () => {
    const offenders = sources
      .filter(({ label }) => label !== 'src/renderer/src/lib/terminalRegistry.ts')
      .filter(({ source }) => /\bterm\.dispose\(\)|\bterminal\.dispose\(\)/.test(source))
      .map(({ label }) => label)

    expect(offenders).toEqual([])
  })
})

describe('no hard-coded colours in components', () => {
  it.each(sources.filter(({ label }) => label.endsWith('.tsx')).map(({ label, source }) => [label, source]))(
    '%s',
    (_label, source) => {
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const literals = [
        ...withoutComments.matchAll(/#[0-9a-f]{3}(?:[0-9a-f]{3}(?:[0-9a-f]{2})?)?\b|\brgba?\([\d\s,./%]+\)/gi)
      ].map(([match]) => match)

      expect(literals).toEqual([])
    }
  )
})

describe('components go through lib/api.ts', () => {
  it('never reaches window.elena.invoke directly', () => {
    // call() turns a Result into a value or an ApiError; a raw invoke leaves a
    // component branching on { ok }, which describeError then cannot classify.
    const offenders = sources
      .filter(({ label }) => label !== 'src/renderer/src/lib/api.ts')
      .filter(({ source }) => /window\.elena\.(invoke|subscribe)\b/.test(source))
      .map(({ label }) => label)

    expect(offenders).toEqual([])
  })
})
