/**
 * Application entry point.
 *
 * Security posture (NFR-10, NFR-17, NFR-18, NFR-19):
 *  - context isolation on, sandbox on, Node integration off
 *  - a restrictive CSP applied to every response the renderer loads
 *  - navigation and window creation blocked outside an explicit allowlist
 */
import { app, BrowserWindow, shell, session } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { broadcast, trustWebContents } from './ipc/bus'
import { registerIpcHandlers } from './ipc/register'
import { PtyManager } from './pty/PtyManager'
import { PresetStore } from './store/presetStore'
import { SettingsStore } from './store/settingsStore'
import { WorkspaceStore } from './store/workspaceStore'
import { applyThemePreference, onSystemThemeChanged, resolvedTheme } from './theme'
import { logger } from './logger'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let quitting = false

const workspaces = new WorkspaceStore()
const settings = new SettingsStore()
const presets = new PresetStore()
const pty = new PtyManager({
  onData: (terminalId, chunk) => broadcast('terminal:data', { terminalId, chunk }),
  onStatus: (terminalId, status, pid) =>
    broadcast('terminal:status-changed', pid === undefined ? { terminalId, status } : { terminalId, status, pid }),
  onExit: (terminalId, exitCode, signal) =>
    broadcast('terminal:exit', {
      terminalId,
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(signal === undefined ? {} : { signal }),
      endedAt: new Date().toISOString()
    })
})

// One instance owns the workspace files; a second would race the atomic writes.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  workspaces.load()
  settings.load()
  presets.load()
  applyThemePreference(settings.get().themePreference)

  applyContentSecurityPolicy()
  hardenWebContents()
  registerIpcHandlers({ workspaces, settings, presets, pty, getWindow: () => mainWindow })

  onSystemThemeChanged((theme) => broadcast('theme:changed', { resolvedTheme: theme }))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 1024,
    minWidth: 1180, // Shared UI specification: minimum window size
    minHeight: 720,
    show: false,
    backgroundColor: resolvedTheme() === 'dark' ? '#0B1118' : '#F5F7FA',
    title: 'AI Workspaces',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  trustWebContents(mainWindow.webContents)

  if (isDev) {
    // Renderer errors are otherwise only visible in DevTools; surface them in
    // the dev terminal. Never written to the log file (NFR-09).
    mainWindow.webContents.on('console-message', (details) => {
      console.log(`[renderer:${details.level}] ${details.message}`)
    })
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Renderer reload policy (Open decision, MVP answer): terminate sessions.
  // A reattach buffer would keep children alive with no UI owning them, which is
  // exactly the hidden-orphan case NFR-08 forbids.
  mainWindow.webContents.on('did-start-navigation', (event) => {
    if (event.isSameDocument || !event.isMainFrame) return
    if (pty.runningCount() > 0) {
      logger.info('renderer.navigation-terminating-sessions', { count: pty.runningCount() })
      pty.disposeAll()
    }
  })

  mainWindow.on('close', (event) => {
    if (quitting) return
    // Graceful shutdown of children happens in before-quit; here we only make
    // sure the window does not vanish before that ran.
    quitting = true
    event.preventDefault()
    app.quit()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (isDev && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function applyContentSecurityPolicy(): void {
  // In dev the Vite client needs inline styles and a websocket back to the
  // dev server; the packaged app gets the strict policy.
  const policy = isDev
    ? "default-src 'self' 'unsafe-inline' data: blob: ws: http://localhost:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      // External links open in the user's browser, never in an app window.
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env.ELECTRON_RENDERER_URL
      const allowed = isDev && devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
      if (!allowed) {
        event.preventDefault()
        logger.warn('navigation.blocked', { url })
      }
    })

    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

app.on('before-quit', () => {
  quitting = true
  // NFR-08: every child dies with the app.
  pty.disposeAll()
  try {
    workspaces.saveNow()
  } catch {
    /* already logged; do not block quit on a failed write */
  }
  logger.info('app.quit')
  logger.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (error) => {
  logger.error('main.uncaught-exception', { error })
})
process.on('unhandledRejection', (reason) => {
  logger.error('main.unhandled-rejection', { reason })
})
