import { createRequire } from 'node:module'
import type { AppUpdater } from 'electron-updater'
import type { UpdateClient } from './UpdateManager'

// The main bundle is ESM, but a dynamic `import()` of a CJS dependency that
// lives inside app.asar never settles in a packaged build: asar patches the
// `require` path, not Node's ESM loader, so bootstrap() hangs before any window
// is created. `createRequire` goes through the patched path and resolves
// against app.asar/node_modules. Do not turn this back into `await import()`.
const requireCjs = createRequire(import.meta.url)

export async function createElectronUpdaterClient(): Promise<UpdateClient> {
  // electron-updater constructs its Electron adapter at load time, so it is
  // still loaded lazily — after app.whenReady() — rather than at module scope.
  const { autoUpdater } = requireCjs('electron-updater') as { autoUpdater: AppUpdater }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = false

  return {
    checkForUpdates: async () => {
      await autoUpdater.checkForUpdates()
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(true, true),
    onChecking: (listener) => {
      autoUpdater.on('checking-for-update', listener)
    },
    onAvailable: (listener) => {
      autoUpdater.on('update-available', (info) => listener(info.version))
    },
    onNotAvailable: (listener) => {
      autoUpdater.on('update-not-available', (info) => listener(info.version))
    },
    onProgress: (listener) => {
      autoUpdater.on('download-progress', (progress) => listener(progress))
    },
    onDownloaded: (listener) => {
      autoUpdater.on('update-downloaded', (info) => listener(info.version))
    },
    onError: (listener) => {
      autoUpdater.on('error', listener)
    }
  }
}

export function createDisabledUpdaterClient(): UpdateClient {
  return {
    checkForUpdates: () => Promise.resolve(),
    quitAndInstall: () => {},
    onChecking: () => {},
    onAvailable: () => {},
    onNotAvailable: () => {},
    onProgress: () => {},
    onDownloaded: () => {},
    onError: () => {}
  }
}
