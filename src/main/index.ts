/**
 * Application entry point.
 *
 * Security posture (NFR-10, NFR-17, NFR-18, NFR-19):
 *  - context isolation on, sandbox on, Node integration off
 *  - a restrictive CSP applied to every response the renderer loads
 *  - navigation and window creation blocked outside an explicit allowlist
 */
import { app, BrowserWindow, Menu, shell, session } from 'electron'
import { fileURLToPath } from 'node:url'
import { broadcast } from './ipc/bus'
import { registerIpcHandlers } from './ipc/register'
import { PtyManager } from './pty/PtyManager'
import { contentSecurityPolicy, isAllowedExternalUrl, isAllowedNavigationUrl } from './security/posture'
import {
  closeAllDetachedWindows,
  configureWindows,
  createMainWindow,
  getMainWindow
} from './windows'
import { PresetStore } from './store/presetStore'
import { SettingsStore } from './store/settingsStore'
import { WorkspaceStore } from './store/workspaceStore'
import { applyThemePreference, onSystemThemeChanged, resolvedTheme } from './theme'
import { logger } from './logger'
import { UpdateManager } from './update/UpdateManager'
import { currentDistribution, updatesSupported } from './update/distribution'
import { createDisabledUpdaterClient, createElectronUpdaterClient } from './update/electronUpdaterClient'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const isDev = !app.isPackaged

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
    const window = getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  // Only load electron-updater where it can actually run (packaged Windows).
  const updatesEnabled = updatesSupported(currentDistribution())
  const updateClient = updatesEnabled ? await createElectronUpdaterClient() : createDisabledUpdaterClient()
  const updates = new UpdateManager(updateClient, {
    enabled: updatesEnabled,
    currentVersion: app.getVersion(),
    emit: (state) => broadcast('app:update-state', state)
  })

  workspaces.load()
  settings.load()
  presets.load()
  applyThemePreference(settings.get().themePreference)

  applyContentSecurityPolicy()
  hardenWebContents()
  registerIpcHandlers({ workspaces, settings, presets, pty, updates, getWindow: getMainWindow })

  onSystemThemeChanged((theme) => broadcast('theme:changed', { resolvedTheme: theme }))

  configureWindows({
    isDev,
    dirname: __dirname,
    devServerUrl: process.env.ELECTRON_RENDERER_URL,
    backgroundColor: () => (resolvedTheme() === 'dark' ? '#282C34' : '#F5F7FA'),
    onMainNavigated: () => {
      if (pty.runningCount() > 0) {
        logger.info('renderer.navigation-terminating-sessions', { count: pty.runningCount() })
        pty.disposeAll()
      }
      // Those sessions are gone, so no detached window still has a UI to own.
      closeAllDetachedWindows()
    },
    onMainClosed: (event) => {
      if (quitting) return
      // Graceful shutdown of children happens in before-quit; here we only make
      // sure the window does not vanish before that ran.
      quitting = true
      event.preventDefault()
      app.quit()
    }
  })

  Menu.setApplicationMenu(null)
  createMainWindow()
  void updates.check()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

function applyContentSecurityPolicy(): void {
  const policy = contentSecurityPolicy(isDev)

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
      if (isAllowedExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigationUrl(url, isDev, process.env.ELECTRON_RENDERER_URL)) {
        event.preventDefault()
        logger.warn('navigation.blocked', { url })
      }
    })

    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

app.on('before-quit', () => {
  quitting = true
  closeAllDetachedWindows()
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
