/**
 * xterm instances live here, outside the React tree.
 *
 * Why: splitting a pane, zooming, or a StrictMode double-mount all change the
 * component tree, and React unmounts the old `TerminalPane`. If the Terminal
 * belonged to the component, every one of those actions would wipe the buffer.
 * Instead each terminal owns a detached DOM node that panes adopt on mount and
 * hand back on unmount — the buffer, scroll position and selection survive.
 *
 * This is also what makes FR-25 (theme switch keeps buffer and focus) and the
 * split/zoom acceptance criteria hold.
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import type { ITheme } from '@xterm/xterm'
import { call } from './api'
import { onTerminalData } from './terminalBus'

export type TerminalEntry = {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  element: HTMLDivElement
  /** False until the first PTY create has been requested for this id. */
  dispose: () => void
}

const registry = new Map<string, TerminalEntry>()

/**
 * xterm cannot read CSS variables, so the whole ITheme — including all sixteen
 * ANSI slots — is resolved from tokens here. Leaving the ANSI slots unset falls
 * back to xterm's built-in palette, which is designed for dark backgrounds and
 * renders bright yellow/green/cyan almost invisibly in light mode.
 */
export function readTerminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string): string => styles.getPropertyValue(name).trim()
  return {
    background: token('--term-bg'),
    foreground: token('--term-fg'),
    cursor: token('--term-cursor'),
    cursorAccent: token('--term-bg'),
    selectionBackground: token('--term-selection'),

    black: token('--term-black'),
    red: token('--term-red'),
    green: token('--term-green'),
    yellow: token('--term-yellow'),
    blue: token('--term-blue'),
    magenta: token('--term-magenta'),
    cyan: token('--term-cyan'),
    white: token('--term-white'),
    brightBlack: token('--term-bright-black'),
    brightRed: token('--term-bright-red'),
    brightGreen: token('--term-bright-green'),
    brightYellow: token('--term-bright-yellow'),
    brightBlue: token('--term-bright-blue'),
    brightMagenta: token('--term-bright-magenta'),
    brightCyan: token('--term-bright-cyan'),
    brightWhite: token('--term-bright-white')
  }
}

export function acquireTerminal(
  terminalId: string,
  options: { scrollback: number; onOutput: () => void }
): TerminalEntry {
  const existing = registry.get(terminalId)
  if (existing) {
    existing.term.options.scrollback = options.scrollback
    return existing
  }

  const element = document.createElement('div')
  element.style.width = '100%'
  element.style.height = '100%'

  const term = new Terminal({
    fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: options.scrollback,
    allowProposedApi: true,
    theme: readTerminalTheme()
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.open(element)

  const inputDisposable = term.onData((data) => {
    void call('terminal:write', { terminalId, data }).catch(() => {
      /* writing to an exited session is expected, not an error worth showing */
    })
  })

  const resizeDisposable = term.onResize(({ cols, rows }) => {
    void call('terminal:resize', { terminalId, cols, rows }).catch(() => {})
  })

  const unsubscribe = onTerminalData(terminalId, (chunk) => {
    term.write(chunk)
    options.onOutput()
  })

  const entry: TerminalEntry = {
    term,
    fit,
    search,
    element,
    dispose: () => {
      unsubscribe()
      inputDisposable.dispose()
      resizeDisposable.dispose()
      term.dispose()
      element.remove()
      registry.delete(terminalId)
    }
  }
  registry.set(terminalId, entry)
  return entry
}

export function getTerminal(terminalId: string): TerminalEntry | undefined {
  return registry.get(terminalId)
}

/** Called when a terminal is closed for good. */
export function releaseTerminal(terminalId: string): void {
  registry.get(terminalId)?.dispose()
}

/** Repaints every live terminal after a theme change, without touching buffers. */
export function applyThemeToAll(): void {
  const theme = readTerminalTheme()
  for (const entry of registry.values()) entry.term.options.theme = theme
}

export function applyScrollbackToAll(scrollback: number): void {
  for (const entry of registry.values()) entry.term.options.scrollback = scrollback
}
