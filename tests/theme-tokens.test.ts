/**
 * Guard suite: the design-token contract.
 *
 * Two failures this catches that nothing else can:
 *  - a token declared in one theme block and not the other, which shows up only
 *    when a user switches theme;
 *  - an ANSI slot `readTerminalTheme` reads but tokens.css never declares, which
 *    silently falls back to xterm's own dark-tuned palette.
 *
 * A failure here means a token went missing, not that the test is stale.
 */
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES_DIR = join(process.cwd(), 'src/renderer/src/styles')
const TOKENS_PATH = join(STYLES_DIR, 'tokens.css')
const REGISTRY_PATH = join(process.cwd(), 'src/renderer/src/lib/terminalRegistry.ts')

/**
 * Comments are stripped first. tokens.css documents contrast ratios in prose
 * that names tokens and colours, so a comment mentioning "--surface-elevated:"
 * otherwise parses as a declaration and swallows the real one after it.
 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const tokensCss = stripComments(readFileSync(TOKENS_PATH, 'utf8'))

/**
 * Colour literals allowed outside tokens.css, matched by their declaration text
 * so the allowlist survives reformatting. Each is a scrim or a comment about
 * xterm's own hard-coded value, not a themed surface.
 */
const ALLOWED_LITERALS: readonly string[] = ['rgb(0 0 0 / 45%)']

function block(selector: string): string {
  const start = tokensCss.indexOf(selector)
  if (start === -1) throw new Error(`selector not found in tokens.css: ${selector}`)
  const open = tokensCss.indexOf('{', start)
  const close = tokensCss.indexOf('}', open)
  return tokensCss.slice(open + 1, close)
}

function declarations(source: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [, name, value] of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (name && value) found.set(name, value.trim())
  }
  return found
}

const dark = declarations(block(":root[data-theme='dark']"))
const light = declarations(block(":root[data-theme='light']"))

describe('theme parity', () => {
  it('declares the same tokens in both themes', () => {
    const missingInLight = [...dark.keys()].filter((name) => !light.has(name))
    const missingInDark = [...light.keys()].filter((name) => !dark.has(name))

    expect(missingInLight, 'declared in dark but not light').toEqual([])
    expect(missingInDark, 'declared in light but not dark').toEqual([])
  })

  it('declares a non-trivial number of tokens', () => {
    // Cheap sanity check that the block parser did not silently match nothing.
    expect(dark.size).toBeGreaterThan(30)
  })

  it('sets color-scheme in both themes so native controls follow', () => {
    expect(block(":root[data-theme='dark']")).toContain('color-scheme: dark')
    expect(block(":root[data-theme='light']")).toContain('color-scheme: light')
  })
})

describe('xterm theme slots', () => {
  const registrySource = readFileSync(REGISTRY_PATH, 'utf8')
  const slots = [
    ...new Set(
      [...registrySource.matchAll(/token\('(--[a-z0-9-]+)'\)/gi)]
        .map(([, name]) => name)
        .filter((name): name is string => Boolean(name))
    )
  ]

  it('reads a full palette', () => {
    // 16 ANSI slots plus bg/fg/cursor/selection, deduplicated.
    expect(slots.length).toBeGreaterThanOrEqual(20)
  })

  it.each([['dark', dark], ['light', light]] as const)(
    'declares every slot readTerminalTheme reads in the %s theme',
    (_name, theme) => {
      expect(slots.filter((slot) => !theme.has(slot))).toEqual([])
    }
  )

  it('resolves terminal slots to literal colours, not var() chains', () => {
    // getComputedStyle resolves var() for us, but a chain into a token that is
    // itself missing yields '' — which xterm reads as "use my own palette".
    for (const slot of slots) {
      expect(dark.get(slot), `${slot} (dark)`).not.toContain('var(')
      expect(light.get(slot), `${slot} (light)`).not.toContain('var(')
    }
  })
})

describe('no hard-coded colours outside tokens.css', () => {
  const cssFiles = readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith('.css') && name !== 'tokens.css')
    .map((name) => join(STYLES_DIR, name))

  it.each(cssFiles.map((path) => [relative(process.cwd(), path), path]))('%s', (_label, path) => {
    const source = readFileSync(path, 'utf8')
    const withoutComments = stripComments(source)
    const literals = [
      ...withoutComments.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi)
    ].map(([match]) => match)

    expect(literals.filter((literal) => !ALLOWED_LITERALS.includes(literal))).toEqual([])
  })
})
