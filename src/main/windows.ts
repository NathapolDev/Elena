/**
 * Window management.
 *
 * There is one main window and any number of detached windows, each showing a
 * single terminal that was pulled out of the main layout. Two things make that
 * safe:
 *
 *  - the PTY never moves. `PtyManager` is app-wide and keyed by terminal id, so
 *    detaching is a UI relocation and the child process is untouched (NFR-08).
 *  - detached state is deliberately in-memory only. A relaunch brings every
 *    terminal back to the main window, which matches the rule that a restored
 *    session is configuration and not a live process (FR-14) and keeps the
 *    persisted schema unchanged.
 *
 * Every window gets the same locked-down `webPreferences` (NFR-18); a detached
 * window is not a lesser-privileged frame, it is the same renderer in a
 * different role.
 */
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { broadcast, trustWebContents } from './ipc/bus'
import { BROWSER_WINDOW_WEB_PREFERENCES } from './security/posture'
import { logger } from './logger'

export type WindowContext = {
  isDev: boolean
  dirname: string
  devServerUrl: string | undefined
  backgroundColor: () => string
  /** Called when the main window navigates, so sessions do not outlive their UI. */
  onMainNavigated: () => void
  /** The main window closing is the app closing. */
  onMainClosed: (event: Electron.Event) => void
}

let context: WindowContext | null = null
let mainWindow: BrowserWindow | null = null
const detached = new Map<string, BrowserWindow>()

export function configureWindows(next: WindowContext): void {
  context = next
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function detachedTerminalIds(): string[] {
  return [...detached.keys()]
}

/**
 * `query` is how a launch decides what the window opens on — Explorer's
 * "Open in Elena" passes the workspace it resolved the folder to. Empty for an
 * ordinary launch, which lands on the first workspace.
 */
export function createMainWindow(query: Record<string, string> = {}): BrowserWindow {
  const ctx = require_(context)

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1024,
    minWidth: 1180, // Shared UI specification: minimum window size
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: ctx.backgroundColor(),
    title: 'Elena',
    icon: windowIcon(ctx),
    webPreferences: {
      preload: join(ctx.dirname, '../preload/index.cjs'),
      ...BROWSER_WINDOW_WEB_PREFERENCES
    }
  })

  const window = mainWindow
  prepare(window, ctx)

  // Renderer reload policy (Open decision, MVP answer): terminate sessions.
  // A reattach buffer would keep children alive with no UI owning them, which is
  // exactly the hidden-orphan case NFR-08 forbids.
  window.webContents.on('did-start-navigation', (event) => {
    if (event.isSameDocument || !event.isMainFrame) return
    ctx.onMainNavigated()
  })

  window.on('close', ctx.onMainClosed)
  window.on('closed', () => {
    mainWindow = null
  })

  load(window, ctx, query)
  return window
}

/**
 * Opens a terminal in its own window. Idempotent: detaching an already
 * detached terminal focuses the window it is in rather than opening a second
 * one, which would leave two renderers fighting over the same PTY's input.
 */
export function detachTerminal(workspaceId: string, terminalId: string, title: string): string[] {
  const existing = detached.get(terminalId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return detachedTerminalIds()
  }

  const ctx = require_(context)
  const window = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 420,
    minHeight: 260,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: ctx.backgroundColor(),
    title: `${title} — Elena`,
    icon: windowIcon(ctx),
    webPreferences: {
      preload: join(ctx.dirname, '../preload/index.cjs'),
      ...BROWSER_WINDOW_WEB_PREFERENCES
    }
  })

  detached.set(terminalId, window)
  prepare(window, ctx)

  // The main window answers a renderer navigation by terminating sessions; the
  // proportionate answer here is to give the terminal back rather than kill it,
  // since a reloaded detached renderer would rebuild an empty xterm anyway.
  // Leaving this unhandled would strand a window whose UI no longer owns
  // anything. Registered only once the first load has finished — the initial
  // navigation is this window being born, not a reload.
  window.webContents.once('did-finish-load', () => {
    window.webContents.on('did-start-navigation', (event) => {
      if (event.isSameDocument || !event.isMainFrame) return
      if (detached.get(terminalId) === window) reattachTerminal(terminalId)
    })
  })

  // Closing the window is how a user says "put it back": the terminal keeps
  // running throughout and reappears in the main layout.
  window.on('closed', () => {
    if (detached.get(terminalId) === window) {
      detached.delete(terminalId)
      logger.info('window.reattached', { terminalId })
      broadcast('window:detached-changed', { terminalIds: detachedTerminalIds() })
    }
  })

  load(window, ctx, { role: 'detached', workspaceId, terminalId })
  logger.info('window.detached', { terminalId })
  broadcast('window:detached-changed', { terminalIds: detachedTerminalIds() })
  return detachedTerminalIds()
}

/** Brings a terminal back to the main window by closing the window holding it. */
export function reattachTerminal(terminalId: string): string[] {
  const window = detached.get(terminalId)
  if (!window) return detachedTerminalIds()
  detached.delete(terminalId)
  if (!window.isDestroyed()) window.destroy()
  logger.info('window.reattached', { terminalId })
  broadcast('window:detached-changed', { terminalIds: detachedTerminalIds() })
  return detachedTerminalIds()
}

/** Closing a terminal must not leave a window pointing at a dead session. */
export function closeDetachedWindowFor(terminalId: string): void {
  if (detached.has(terminalId)) reattachTerminal(terminalId)
}

export function closeAllDetachedWindows(): void {
  for (const terminalId of [...detached.keys()]) reattachTerminal(terminalId)
}

function prepare(window: BrowserWindow, ctx: WindowContext): void {
  trustWebContents(window.webContents)

  if (ctx.isDev) {
    // Renderer errors are otherwise only visible in DevTools; surface them in
    // the dev terminal. Never written to the log file (NFR-09).
    window.webContents.on('console-message', (details) => {
      console.log(`[renderer:${details.level}] ${details.message}`)
    })
  }

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })
}

function load(window: BrowserWindow, ctx: WindowContext, query: Record<string, string>): void {
  if (ctx.isDev && ctx.devServerUrl) {
    const search = new URLSearchParams(query).toString()
    // Still prefixed by the dev server origin, so `isAllowedNavigationUrl` holds.
    void window.loadURL(search ? `${ctx.devServerUrl}?${search}` : ctx.devServerUrl)
    return
  }
  void window.loadFile(join(ctx.dirname, '../renderer/index.html'), { query })
}

function windowIcon(ctx: WindowContext): string {
  return ctx.isDev
    ? join(process.cwd(), 'src/renderer/public/elena.png')
    : join(ctx.dirname, '../renderer/elena.png')
}

function require_(value: WindowContext | null): WindowContext {
  if (!value) throw new Error('configureWindows must run before any window is created.')
  return value
}
