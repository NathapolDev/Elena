/**
 * Shipped inside the app (`src/renderer/src/styles/fonts.css`) so the default
 * terminal has Nerd Font glyphs on a machine that has never installed one —
 * Elena is offline-only and cannot fetch a font at runtime.
 *
 * Always quoted wherever it appears: a CSS identifier cannot start with a digit,
 * so an unquoted `0xProto` invalidates the whole font-family declaration.
 */
export const BUNDLED_TERMINAL_FONT_FAMILY = '0xProto Nerd Font Mono'

export const DEFAULT_TERMINAL_FONT_STACK = `'${BUNDLED_TERMINAL_FONT_FAMILY}', 'JetBrains Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace`
export const DEFAULT_TERMINAL_FONT_SIZE = 13
export const MIN_TERMINAL_FONT_SIZE = 8
export const MAX_TERMINAL_FONT_SIZE = 48
export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.2
export const MIN_TERMINAL_LINE_HEIGHT = 1
export const MAX_TERMINAL_LINE_HEIGHT = 2

/** Stores a family name, never a user-authored CSS expression. */
export function terminalFontStack(family: string | null): string {
  if (!family) return DEFAULT_TERMINAL_FONT_STACK
  const quotedFamily = family.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `"${quotedFamily}", ${DEFAULT_TERMINAL_FONT_STACK}`
}
