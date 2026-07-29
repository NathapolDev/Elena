/**
 * The bundled font is only useful if the CSS, the family constant and the files
 * on disk agree. Vitest runs in a node environment and never processes CSS, so
 * fonts.css is read as text — which is the point: this catches a rename or a
 * deleted .ttf in milliseconds, without waiting for a build or an E2E run.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUNDLED_TERMINAL_FONT_FAMILY } from '@shared/terminalTypography'

const cssPath = resolve('src/renderer/src/styles/fonts.css')
// The header comment explains the font-display choice in prose, so counting
// declarations means looking at the rules only.
const css = readFileSync(cssPath, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '')

describe('bundled font face declarations', () => {
  it('declares the family name the default stack asks for', () => {
    expect(css).toContain(`font-family: '${BUNDLED_TERMINAL_FONT_FAMILY}'`)
  })

  it('ships every face it references', () => {
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1] as string)
    expect(urls).toHaveLength(3)
    for (const url of urls) expect(existsSync(resolve(dirname(cssPath), url))).toBe(true)
  })

  it('covers regular, bold and italic — upstream has no bold-italic face', () => {
    expect(css).toContain('font-weight: 400')
    expect(css).toContain('font-weight: 700')
    expect(css).toContain('font-style: italic')
  })

  it('blocks rather than swaps, so xterm never measures the fallback', () => {
    expect(css.match(/font-display: block/g)).toHaveLength(3)
  })
})
