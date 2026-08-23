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
import { WebglAddon } from '@xterm/addon-webgl'
import type { ITheme } from '@xterm/xterm'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_FONT_STACK,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  terminalFontStack
} from '@shared/terminalTypography'
import { call } from './api'
import { onTerminalData } from './terminalBus'

export type TerminalEntry = {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  /** Null when GPU rendering is off or unavailable — the DOM renderer is drawing this terminal. */
  webgl: WebglAddon | null
  element: HTMLDivElement
  /** Re-measure now (mount, zoom, tab switch). */
  fitNow: () => void
  /** Re-measure once the size stops changing — use this for ResizeObserver. */
  scheduleFit: () => void
  /** False until the first PTY create has been requested for this id. */
  dispose: () => void
}

const registry = new Map<string, TerminalEntry>()
/** Mirrors the `gpuRendering` setting; new terminals are built to match it. */
let currentGpuRendering = true

export type TerminalTypography = {
  fontFamily: string | null
  fontSize: number
  lineHeight: number
}

let currentTypography: TerminalTypography = {
  fontFamily: null,
  fontSize: DEFAULT_TERMINAL_FONT_SIZE,
  lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT
}

/**
 * A divider drag fires the pane's ResizeObserver on every pointer move. Each
 * fit that changes cols/rows resizes the ConPTY, and the shell redraws its
 * prompt for every one of those — dozens of redraws racing each other leave the
 * prompt anchored to a row that no longer exists, so the next thing typed lands
 * mid-buffer instead of on the last line. One resize per settled size instead.
 */
const RESIZE_SETTLE_MS = 60

/**
 * ConPTY does not resize like a POSIX pty, and xterm only compensates when it
 * is told which backend it is attached to: growing the row count makes ConPTY
 * emit blank rows rather than handing scrollback back to the viewport, and
 * pre-21376 builds do not report wrapped lines at all. Left undeclared, xterm
 * reflows against assumptions ConPTY does not honour and rows get replaced —
 * the same "typing after a resize goes to the wrong line" symptom.
 *
 * `PtyManager` always spawns with `useConptyDll`, so the backend is never winpty.
 */
function windowsPtyOptions(): { backend: 'conpty'; buildNumber: number } | undefined {
  const build = window.elena?.windowsBuild
  if (window.elena?.platform !== 'win32' || build == null) return undefined
  return { backend: 'conpty', buildNumber: build }
}

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

/**
 * P4/F1: the DOM renderer rebuilds spans per changed cell, which is the ceiling
 * the "10 noisy PTYs under 200 ms" criterion in RELEASE.md meets first. WebGL
 * draws the grid from a texture atlas instead.
 *
 * Both failure modes fall back to the DOM renderer rather than to a blank pane:
 * construction throws where there is no usable GL context, and a context lost
 * later — the compositor dropping it, or Chromium evicting the oldest of its
 * ~16 live contexts because this app holds one per terminal — is answered by
 * disposing the addon, which is what returns xterm to the DOM renderer.
 * Disposal is safe to repeat and clearTextureAtlas() is a no-op afterwards, so
 * nothing has to be nulled.
 *
 * Returns null rather than throwing: a terminal that cannot use the GPU is a
 * terminal drawn by the DOM, not a terminal that failed to open.
 */
function loadWebgl(term: Terminal): WebglAddon | null {
  try {
    const addon = new WebglAddon()
    addon.onContextLoss(() => addon.dispose())
    term.loadAddon(addon)
    return addon
  } catch {
    return null
  }
}

/**
 * Switches every live terminal between the GPU and DOM renderers in place.
 *
 * xterm swaps renderers without touching the buffer, so this keeps scrollback,
 * selection and focus — the same property that makes the theme flip safe. A
 * pane is never remounted for this.
 */
export function applyGpuRenderingToAll(enabled: boolean): void {
  if (enabled === currentGpuRendering) return
  currentGpuRendering = enabled
  for (const entry of registry.values()) {
    if (enabled) {
      entry.webgl = loadWebgl(entry.term)
    } else {
      entry.webgl?.dispose()
      entry.webgl = null
    }
    entry.fitNow()
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

  const windowsPty = windowsPtyOptions()
  const term = new Terminal({
    fontFamily: currentTypography.fontFamily
      ? terminalFontStack(currentTypography.fontFamily)
      : DEFAULT_TERMINAL_FONT_STACK,
    fontSize: currentTypography.fontSize,
    lineHeight: currentTypography.lineHeight,
    cursorBlink: true,
    scrollback: options.scrollback,
    allowProposedApi: true,
    theme: readTerminalTheme(),
    ...(windowsPty ? { windowsPty } : {})
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.open(element)

  const webgl = currentGpuRendering ? loadWebgl(term) : null

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

  let settleTimer: ReturnType<typeof setTimeout> | null = null

  const fitNow = (): void => {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    // A pane measures zero while the layout is mid-update, while its tab is
    // being swapped, and whenever the window is minimised. Fitting then would
    // resize the PTY to xterm's 2x1 minimum and make the shell rewrap its
    // prompt to a size the user never chose — which survives the restore.
    const host = element.parentElement
    if (!host || host.clientWidth < 1 || host.clientHeight < 1) return

    const buffer = term.buffer.active
    const wasAtBottom = buffer.viewportY >= buffer.baseY
    try {
      fit.fit()
    } catch {
      return
    }
    // Reflow moves the viewport; a user parked at the prompt must stay there.
    if (wasAtBottom) term.scrollToBottom()
  }

  const scheduleFit = (): void => {
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => {
      settleTimer = null
      fitNow()
    }, RESIZE_SETTLE_MS)
  }

  const entry: TerminalEntry = {
    term,
    fit,
    search,
    webgl,
    element,
    fitNow,
    scheduleFit,
    dispose: () => {
      if (settleTimer) clearTimeout(settleTimer)
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

export function applyTerminalTypographyToAll(typography: TerminalTypography): void {
  currentTypography = { ...typography }
  const fontFamily = terminalFontStack(typography.fontFamily)
  for (const entry of registry.values()) {
    entry.term.options.fontFamily = fontFamily
    entry.term.options.fontSize = typography.fontSize
    entry.term.options.lineHeight = typography.lineHeight
    entry.scheduleFit()
  }
}

/**
 * A face that finishes decoding after a Terminal was constructed leaves that
 * terminal measured against the fallback. xterm exposes no way to ask for a
 * re-measure, and CharSizeService only listens for a fontFamily/fontSize option
 * *change* — OptionsService drops a write whose value is identical, so
 * reassigning the same stack does nothing at all. Nudge through an equivalent
 * value first to force the measure, then re-fit against the new cell box.
 *
 * The intermediate value appends a redundant `monospace` to a stack that already
 * ends in `monospace`, so it selects the identical face; even a paint landing
 * between the two writes is visually identical.
 *
 * The WebGL renderer caches glyphs in a texture atlas keyed by the old cell
 * box, so the re-measure has to be followed by dropping that atlas or the
 * terminal keeps painting the previous face at the new size. No-op when the
 * addon is absent or already fell back to the DOM renderer.
 */
export function remeasureTerminalFonts(): void {
  const fontFamily = terminalFontStack(currentTypography.fontFamily)
  for (const entry of registry.values()) {
    entry.term.options.fontFamily = `${fontFamily}, monospace`
    entry.term.options.fontFamily = fontFamily
    entry.webgl?.clearTextureAtlas()
    entry.fitNow()
  }
}
