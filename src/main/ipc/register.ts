/**
 * Wires the IPC contract to the stores and the PTY manager. This is the only
 * place where renderer intent turns into filesystem or process effects.
 */
import { app, dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { requestSchemas } from '@shared/schemas'
import { broadcast, fail, ok, registerCommand } from './bus'
import { readGitBranch } from '../git/branch'
import { GitPathNotChangedError, readGitChanges, readGitFileDiff } from '../git/changes'
import { discoverShells } from '../pty/shells'
import { resolveExecutable, validateDirectory, validateFile } from '../security/paths'
import {
  explorerContextMenuSupported,
  registerExplorerContextMenu,
  unregisterExplorerContextMenu
} from '../shell/explorerContextMenu'
import { vscodeUrlForFile } from '../shell/vscode'
import { applyThemePreference, resolvedTheme } from '../theme'
import { closeDetachedWindowFor, detachTerminal, detachedTerminalIds, reattachTerminal } from '../windows'
import { logger } from '../logger'
import type { PtyManager } from '../pty/PtyManager'
import type { PresetStore } from '../store/presetStore'
import type { SettingsStore } from '../store/settingsStore'
import { SCRATCH_WORKSPACE_ID } from '../store/workspaceStore'
import type { WorkspaceStore } from '../store/workspaceStore'
import type { UpdateManager } from '../update/UpdateManager'

export type Deps = {
  workspaces: WorkspaceStore
  settings: SettingsStore
  presets: PresetStore
  pty: PtyManager
  updates: UpdateManager
  getWindow: () => BrowserWindow | null
  /** The main window's renderer is subscribed; anything queued for it can go. */
  onRendererReady: () => void
}

/**
 * P1: a divider drag sends a layout patch per animation frame, and every window
 * answers `workspace:changed` with a full `workspace:list`. The disk write was
 * already debounced (FR-03); the broadcast was not, so the drag cost N windows
 * x a full workspace clone per frame.
 *
 * Only the layout-only patch is coalesced. Anything touching `terminals` still
 * converges immediately, because a second window holding a stale copy is how a
 * terminal silently disappears from workspaces.json.
 */
const LAYOUT_BROADCAST_MS = 120
let layoutBroadcastTimer: NodeJS.Timeout | null = null

function workspaceChanged(workspaceId: string | null): void {
  if (layoutBroadcastTimer) {
    clearTimeout(layoutBroadcastTimer)
    layoutBroadcastTimer = null
  }
  broadcast('workspace:changed', { workspaceId })
}

function workspaceChangedSoon(workspaceId: string): void {
  if (layoutBroadcastTimer) return
  layoutBroadcastTimer = setTimeout(() => {
    layoutBroadcastTimer = null
    broadcast('workspace:changed', { workspaceId })
  }, LAYOUT_BROADCAST_MS)
}

export function registerIpcHandlers(deps: Deps): void {
  const { workspaces, settings, presets, pty, updates } = deps

  // Answered before anything is broadcast to this window, so a queued shell
  // request is delivered to subscriptions that exist rather than into the gap
  // between `did-finish-load` and React running the effect that installs them.
  registerCommand('app:renderer-ready', requestSchemas['app:renderer-ready'], () => {
    deps.onRendererReady()
    return ok({ acknowledged: true } as const)
  })

  registerCommand('app:info', requestSchemas['app:info'], () =>
    ok({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      developer: 'NathapolDev',
      packaged: app.isPackaged
    })
  )

  registerCommand('app:update-status', requestSchemas['app:update-status'], () => ok(updates.getState()))
  registerCommand('app:update-check', requestSchemas['app:update-check'], async () => ok(await updates.check()))
  registerCommand('app:update-install', requestSchemas['app:update-install'], () =>
    updates.install()
      ? ok({ started: true as const })
      : fail('VALIDATION_FAILED', 'The update is not ready to install.')
  )

  /* ---------- workspaces ---------- */

  registerCommand('workspace:list', requestSchemas['workspace:list'], () => ok(workspaces.list()))

  registerCommand('workspace:get', requestSchemas['workspace:get'], ({ id }) => {
    const workspace = workspaces.get(id)
    return workspace ? ok(workspace) : fail('NOT_FOUND', 'Workspace not found.')
  })

  registerCommand('workspace:create', requestSchemas['workspace:create'], ({ name, projectRoot }) => {
    const check = validateDirectory(projectRoot)
    if (!check.ok) {
      return fail(
        'INVALID_CWD',
        `Project folder is not usable (${check.reason}): ${projectRoot}`,
        'choose-directory'
      )
    }
    const workspace = workspaces.create(name, check.path)
    logger.info('workspace.created', { id: workspace.id })
    workspaceChanged(workspace.id)
    return ok(workspace)
  })

  registerCommand('workspace:ensure-scratch', requestSchemas['workspace:ensure-scratch'], () => {
    // The home directory is the widest folder a user always has, and it becomes
    // this workspace's cwd jail like any other project root.
    const check = validateDirectory(app.getPath('home'))
    if (!check.ok) {
      return fail('INVALID_CWD', `Home folder is not usable (${check.reason}).`, 'choose-directory')
    }
    const existing = workspaces.get(SCRATCH_WORKSPACE_ID)
    const staleRoot = Boolean(existing) && !validateDirectory(existing!.projectRoot).ok
    const workspace = workspaces.ensureScratch(check.path, staleRoot)
    const existed = Boolean(existing)
    if (!existed) {
      logger.info('workspace.scratch-created', { id: workspace.id })
      workspaceChanged(workspace.id)
    }
    return ok(workspace)
  })

  registerCommand('workspace:update', requestSchemas['workspace:update'], ({ id, patch }) => {
    const before = workspaces.get(id)
    const updated = workspaces.update(id, patch)
    if (!updated) return fail('NOT_FOUND', 'Workspace not found.')
    // A terminal that has just been closed must not leave a window rendering a
    // configuration that no longer exists.
    if (before && patch.terminals) {
      const survivors = new Set(updated.terminals.map((terminal) => terminal.id))
      for (const terminal of before.terminals) {
        if (!survivors.has(terminal.id)) closeDetachedWindowFor(terminal.id)
      }
    }
    const layoutOnly = Object.keys(patch).length === 1 && patch.layout !== undefined
    if (layoutOnly) workspaceChangedSoon(id)
    else workspaceChanged(id)
    return ok(updated)
  })

  registerCommand('workspace:delete', requestSchemas['workspace:delete'], ({ id }) => {
    const workspace = workspaces.get(id)
    if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')

    // Kill this workspace's sessions before dropping its configuration, so a
    // deleted workspace cannot leave a running child behind (NFR-08).
    for (const terminal of workspace.terminals) {
      closeDetachedWindowFor(terminal.id)
      pty.dispose(terminal.id)
    }
    workspaces.delete(id)
    // FR-05: app configuration only — nothing under projectRoot is touched.
    logger.info('workspace.deleted', { id })
    workspaceChanged(null)
    return ok({ id })
  })

  /* ---------- windows ---------- */

  registerCommand('window:detach', requestSchemas['window:detach'], ({ workspaceId, terminalId, title }) => {
    const workspace = workspaces.get(workspaceId)
    if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')
    if (!workspace.terminals.some((terminal) => terminal.id === terminalId)) {
      return fail('NOT_FOUND', 'Terminal configuration not found.')
    }
    return ok({ terminalIds: detachTerminal(workspaceId, terminalId, title) })
  })

  registerCommand('window:reattach', requestSchemas['window:reattach'], ({ terminalId }) =>
    ok({ terminalIds: reattachTerminal(terminalId) })
  )

  registerCommand('window:detached', requestSchemas['window:detached'], () =>
    ok({ terminalIds: detachedTerminalIds() })
  )

  /* ---------- terminals ---------- */

  registerCommand(
    'terminal:create',
    requestSchemas['terminal:create'],
    ({ workspaceId, terminalId, cols, rows }) => {
      const workspace = workspaces.get(workspaceId)
      if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')

      const config = workspace.terminals.find((t) => t.id === terminalId)
      if (!config) return fail('NOT_FOUND', 'Terminal configuration not found.')

      const result = pty.create(config, cols, rows, workspace.projectRoot)
      if (!result.ok) {
        logger.warn('terminal.create-failed', { terminalId, code: result.error.code })
        return { ok: false, error: result.error }
      }
      logger.info('terminal.created', { terminalId, pid: result.session.pid })
      return ok(result.session)
    }
  )

  registerCommand('terminal:write', requestSchemas['terminal:write'], ({ terminalId, data }) => {
    // Never logged: this is user keystrokes (NFR-09).
    return pty.write(terminalId, data) ? ok(null) : fail('NOT_FOUND', 'Session is not running.')
  })

  registerCommand('terminal:resize', requestSchemas['terminal:resize'], ({ terminalId, cols, rows }) => {
    pty.resize(terminalId, cols, rows)
    return ok(null)
  })

  registerCommand('terminal:terminate', requestSchemas['terminal:terminate'], ({ terminalId }) => {
    pty.terminate(terminalId)
    return ok(null)
  })

  registerCommand(
    'terminal:restart',
    requestSchemas['terminal:restart'],
    async ({ terminalId, cols, rows }) => {
      const workspace = workspaces.list().find((w) => w.terminals.some((t) => t.id === terminalId))
      if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')
      const config = workspace.terminals.find((t) => t.id === terminalId)
      if (!config) return fail('NOT_FOUND', 'Terminal configuration not found.')

      pty.dispose(terminalId)
      // Give the OS a tick to release the pipe before rebinding the same id.
      await new Promise((resolve) => setTimeout(resolve, 50))

      const result = pty.create(config, cols, rows, workspace.projectRoot)
      if (!result.ok) return { ok: false, error: result.error }
      logger.info('terminal.restarted', { terminalId, pid: result.session.pid })
      return ok(result.session)
    }
  )

  registerCommand('terminal:list-sessions', requestSchemas['terminal:list-sessions'], () =>
    ok(pty.listSessions())
  )

  /* ---------- presets ---------- */

  registerCommand('preset:list', requestSchemas['preset:list'], () => ok(presets.list()))
  registerCommand('preset:create', requestSchemas['preset:create'], (input) => ok(presets.create(input)))
  registerCommand('preset:update', requestSchemas['preset:update'], ({ id, patch }) => {
    const updated = presets.update(id, patch)
    return updated ? ok(updated) : fail('NOT_FOUND', 'Preset not found.')
  })
  registerCommand('preset:delete', requestSchemas['preset:delete'], ({ id }) =>
    presets.delete(id)
      ? ok({ id })
      : fail('VALIDATION_FAILED', 'Built-in presets cannot be deleted. Reset them instead.')
  )
  registerCommand('preset:reset', requestSchemas['preset:reset'], () => ok(presets.resetBuiltIns()))

  /* ---------- git ---------- */

  // Read-only and best effort: a folder outside a repo is a `null`, not an
  // error, so the pane header simply shows no branch.
  registerCommand('git:branch', requestSchemas['git:branch'], ({ path }) => ok(readGitBranch(path)))

  registerCommand('git:changes', requestSchemas['git:changes'], async ({ workspaceId }) => {
    const workspace = workspaces.get(workspaceId)
    if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')
    const root = validateDirectory(workspace.projectRoot)
    if (!root.ok) return fail('INVALID_CWD', `Project folder is not usable (${root.reason}).`)
    const git = resolveExecutable('git')
    if (!git) return fail('EXECUTABLE_NOT_FOUND', 'Git is not installed or is not available on PATH.')
    return ok(await readGitChanges(git, root.path))
  })

  registerCommand('git:diff', requestSchemas['git:diff'], async ({ workspaceId, path }) => {
    const workspace = workspaces.get(workspaceId)
    if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')
    const root = validateDirectory(workspace.projectRoot)
    if (!root.ok) return fail('INVALID_CWD', `Project folder is not usable (${root.reason}).`)
    const git = resolveExecutable('git')
    if (!git) return fail('EXECUTABLE_NOT_FOUND', 'Git is not installed or is not available on PATH.')
    try {
      return ok(await readGitFileDiff(git, root.path, path))
    } catch (error) {
      if (error instanceof GitPathNotChangedError) {
        return fail('NOT_FOUND', 'The file is no longer changed.', 'retry')
      }
      throw error
    }
  })

  registerCommand(
    'file:open-in-vscode',
    requestSchemas['file:open-in-vscode'],
    async ({ workspaceId, path }) => {
      const workspace = workspaces.get(workspaceId)
      if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')
      const file = validateFile(path, workspace.projectRoot)
      if (!file.ok) {
        return fail('NOT_FOUND', `File cannot be opened (${file.reason}).`)
      }
      try {
        await shell.openExternal(vscodeUrlForFile(file.path))
        return ok({ opened: true as const })
      } catch {
        return fail('EXECUTABLE_NOT_FOUND', 'VS Code could not be opened.')
      }
    }
  )

  /* ---------- shells, settings, dialogs ---------- */

  registerCommand('shell:list', requestSchemas['shell:list'], () => ok(discoverShells()))

  registerCommand('settings:get', requestSchemas['settings:get'], () =>
    ok({ settings: settings.get(), resolvedTheme: resolvedTheme() })
  )

  registerCommand('settings:update', requestSchemas['settings:update'], (patch) => {
    // The Explorer verb lives in the registry, not in settings.json. Apply it
    // before the write, so a stored preference can never claim something the
    // shell does not actually show, and abandon the whole patch if it fails:
    // this failure has a command to answer, so it belongs in that command's
    // Result and not on `app:error`, which exists for the shell click that has
    // no call to return to. Writing nothing is also what keeps the settings
    // this returns true to disk — there is no half-applied patch to describe.
    if (patch.explorerContextMenu !== undefined && explorerContextMenuSupported(app.isPackaged)) {
      try {
        if (patch.explorerContextMenu) registerExplorerContextMenu(app.getPath('exe'))
        else unregisterExplorerContextMenu()
      } catch {
        // The thrown message is `reg.exe` metadata carrying the profile path;
        // only the outcome belongs in the log (NFR-09).
        logger.error('shell.context-menu.update-failed', { enabled: patch.explorerContextMenu })
        return fail('INTERNAL', 'Could not update the Windows Explorer entry.', 'retry')
      }
    }
    const before = resolvedTheme()
    const next = settings.update(patch)
    if (patch.themePreference) applyThemePreference(patch.themePreference)
    const theme = resolvedTheme()
    // P3: the caller gets the resolved theme in this Result, so the broadcast
    // exists for the *other* windows. Firing it on every settings write meant a
    // font-size nudge repainted every terminal in every window for nothing.
    if (theme !== before) broadcast('theme:changed', { resolvedTheme: theme })
    return ok({ settings: next, resolvedTheme: theme })
  })

  registerCommand('dialog:pick-directory', requestSchemas['dialog:pick-directory'], async (payload) => {
    const window = deps.getWindow()
    if (!window) return fail('INTERNAL', 'No window available.')
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      ...(payload?.defaultPath ? { defaultPath: payload.defaultPath } : {})
    })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return ok(null)
    return ok({ path: picked })
  })

  registerCommand('path:validate', requestSchemas['path:validate'], ({ path, mustBeInside }) => {
    const check = validateDirectory(path, mustBeInside)
    if (!check.ok) {
      return check.reason === 'outside-root'
        ? fail('VALIDATION_FAILED', 'Folder is outside the workspace project root.', 'choose-directory')
        : fail('INVALID_CWD', `Folder is not usable (${check.reason}).`, 'choose-directory')
    }
    return ok({ path: check.path, exists: true, isDirectory: check.isDirectory })
  })
}
