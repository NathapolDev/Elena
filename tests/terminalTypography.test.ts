import { describe, expect, it } from 'vitest'
import {
  BUNDLED_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_STACK,
  terminalFontStack
} from '@shared/terminalTypography'

describe('terminal font stack', () => {
  it('keeps the existing stack when no family is selected', () => {
    expect(terminalFontStack(null)).toBe(DEFAULT_TERMINAL_FONT_STACK)
  })

  it('quotes an installed family name before adding the fallback stack', () => {
    expect(terminalFontStack('Font "Quoted" \\ Family')).toBe(
      `"Font \\"Quoted\\" \\\\ Family", ${DEFAULT_TERMINAL_FONT_STACK}`
    )
  })
})

describe('bundled terminal font', () => {
  it('leads the default stack so a machine with no Nerd Font installed still gets glyphs', () => {
    expect(DEFAULT_TERMINAL_FONT_STACK.startsWith(`'${BUNDLED_TERMINAL_FONT_FAMILY}',`)).toBe(true)
  })

  it('keeps the previous fallbacks behind it', () => {
    expect(DEFAULT_TERMINAL_FONT_STACK).toContain("'Cascadia Mono'")
    expect(DEFAULT_TERMINAL_FONT_STACK.endsWith('monospace')).toBe(true)
  })

  it('quotes the family, because a CSS identifier cannot start with a digit', () => {
    expect(DEFAULT_TERMINAL_FONT_STACK).not.toMatch(/(^|,\s*)0xProto/)
  })
})
