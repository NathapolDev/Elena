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
import type { AppError } from '@shared/types'
import {
  explorerContextMenuAbsent,
  explorerContextMenuMatches,
  explorerContextMenuSupported,
  registerExplorerContextMenu,
  unregisterExplorerContextMenu
} from './shell/explorerContextMenu'
import { openFolderWorkspace } from './shell/openFolder'
import { parseOpenFolderArg } from './shell/openFolderArgs'
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
  // Explorer's "Open in Elena" launches the app again rather than talking to it,
  // so the folder it wants arrives here as the second instance's argv.
  app.on('second-instance', (_event, argv) => {
    const window = getMainWindow()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }

    const requested = parseOpenFolderArg(argv)
    if (!requested) return
    // The lock is taken before `whenReady`, so a click during a cold start has
    // no renderer to talk to yet. `queueOpenFolder` holds it until there is one.
    queueOpenFolder({ path: requested })
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
  registerIpcHandlers({
    workspaces,
    settings,
    presets,
    pty,
    updates,
    getWindow: getMainWindow,
    onRendererReady: () => {
      rendererSubscribed = true
      flushQueuedOpenFolder()
    }
  })

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

  // `applyExplorerContextMenuPreference` blocks the main thread on `reg.exe`,
  // so it waits for a window's first load rather than sitting between the
  // window and its first paint. A window that never finishes loading leaves it
  // for the next one.
  const armDeferredStartup = (window: BrowserWindow): void => {
    // Synchronously, not via the navigation listener: `createMainWindow` has
    // already published this window through `getMainWindow()`, so a click
    // arriving before the first event would be flushed against a flag still
    // left `true` by the window this one replaced.
    rendererSubscribed = false
    // `did-start-navigation` with this filter, matching `windows.ts` — the
    // `did-start-loading` pair would be asymmetric, since it also fires for
    // subframes while `did-finish-load` is main-frame only, and the flag would
    // latch `false` with nothing to set it back.
    window.webContents.on('did-start-navigation', (event) => {
      if (event.isSameDocument || !event.isMainFrame) return
      rendererSubscribed = false
    })
    // Readiness is answered by `app:renderer-ready`, not by this event — the
    // renderer installs its subscriptions a frame or so after the load
    // finishes. The reconcile has no such requirement and stays here.
    window.webContents.once('did-finish-load', applyExplorerContextMenuPreference)
  }

  Menu.setApplicationMenu(null)
  armDeferredStartup(createMainWindow(initialWindowQuery()))
  void updates.check()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) armDeferredStartup(createMainWindow())
  })
}

/**
 * An "Open in Elena" request waiting for a window. The folder is kept
 * unresolved on purpose: `second-instance` can fire before `whenReady`, and
 * resolving against a `WorkspaceStore` that has not loaded yet would find no
 * match and create a duplicate workspace for a folder that already has one.
 */
type QueuedOpenFolder = { path: string } | { error: AppError }

/**
 * At most one request waits at a time: a second click supersedes one that has
 * not landed yet, because the user's latest click is the folder they want the
 * window on, and two `workspace:open-requested` events in a row would only race
 * each other to decide the same thing.
 */
let queuedOpenFolder: QueuedOpenFolder | null = null

/**
 * Whether a renderer is currently listening. `broadcast` is a bare
 * `webContents.send` with no buffering, so an event delivered between the
 * `BrowserWindow` constructor and App.tsx's `subscribe` is dropped outright —
 * and `getMainWindow()` is non-null for that whole gap, which is why window
 * existence is not the thing to test. Cleared when a window is armed and on
 * every main-frame navigation start, since both a replacement window and a
 * reload take those subscriptions down with them.
 *
 * Set only by `app:renderer-ready`, which App.tsx sends after its subscriptions
 * are installed. `did-finish-load` was the closest main could observe on its
 * own, but React runs that effect a frame or so later, which left a sliver of
 * the gap open; the renderer saying so itself is what closes it.
 */
let rendererSubscribed = false

function openFolderError(path: string, reason: string): AppError {
  return {
    code: 'INVALID_CWD',
    message: `That folder cannot be opened (${reason}): ${path}`,
    action: 'choose-directory'
  }
}

/**
 * Parks a request and delivers it if a renderer is already listening. Anything
 * that arrives earlier is settled by `did-finish-load`, so the click can never
 * be answered by a `send` into a window that has nothing subscribed yet.
 */
function queueOpenFolder(request: QueuedOpenFolder): void {
  queuedOpenFolder = request
  if (getMainWindow() && rendererSubscribed) flushQueuedOpenFolder()
}

/** Called once a renderer is listening, and therefore once the stores have loaded. */
function flushQueuedOpenFolder(): void {
  const queued = queuedOpenFolder
  if (!queued) return
  queuedOpenFolder = null

  if ('error' in queued) {
    // Silence here is a click that did nothing and cannot be diagnosed.
    broadcast('app:error', queued.error)
    return
  }

  const outcome = openFolderWorkspace(workspaces, queued.path)
  if (!outcome.ok) {
    broadcast('app:error', openFolderError(queued.path, outcome.reason))
    return
  }
  // The workspace may be brand new, and every window rebuilds its list from
  // `workspace:changed`; send that first so the open request lands on a list
  // that already contains it.
  if (outcome.created) broadcast('workspace:changed', { workspaceId: outcome.workspaceId })
  broadcast('workspace:open-requested', { workspaceId: outcome.workspaceId })
}

/**
 * The workspace a cold start should land on. Only Explorer's verb sets one; an
 * ordinary launch returns an empty query and the renderer picks the first
 * workspace as before. A resolved folder is handed over as the window's own
 * query rather than as an event, so the first render is already correct.
 *
 * Runs after `workspaces.load()`, so resolving here is safe.
 */
function initialWindowQuery(): Record<string, string> {
  const requested = parseOpenFolderArg(process.argv)
  if (!requested) return {}
  const outcome = openFolderWorkspace(workspaces, requested)
  if (outcome.ok) return { workspaceId: outcome.workspaceId }
  // A rejection waits for the window that is about to be created.
  queueOpenFolder({ error: openFolderError(requested, outcome.reason) })
  return {}
}

/**
 * Re-applies the Explorer verb to match the stored preference on every launch.
 * The installer wrote it once; this is what keeps it correct after an update
 * moves the executable, and what makes the Settings toggle survive a relaunch.
 */
function applyExplorerContextMenuPreference(): void {
  if (!explorerContextMenuSupported(app.isPackaged)) return
  const wanted = settings.get().explorerContextMenu
  try {
    // The common launch changes nothing, so check before writing nine values.
    if (wanted) {
      if (explorerContextMenuMatches(app.getPath('exe'))) return
      registerExplorerContextMenu(app.getPath('exe'))
    } else {
      if (explorerContextMenuAbsent()) return
      unregisterExplorerContextMenu()
    }
    logger.info('shell.context-menu.applied', { enabled: wanted })
  } catch {
    // A shell integration is not worth failing a launch over, and the thrown
    // message is not worth logging: it is `reg.exe` metadata, not a diagnosis.
    logger.warn('shell.context-menu.apply-failed', { enabled: wanted })
  }
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
