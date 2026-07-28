/**
 * Wires the IPC contract to the stores and the PTY manager. This is the only
 * place where renderer intent turns into filesystem or process effects.
 */
import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import { requestSchemas } from '@shared/schemas'
import type { RuntimeSession } from '@shared/types'
import { broadcast, fail, ok, registerCommand } from './bus'
import { readGitBranch } from '../git/branch'
import { discoverShells } from '../pty/shells'
import { validateDirectory } from '../security/paths'
import { applyThemePreference, resolvedTheme } from '../theme'
import { logger } from '../logger'
import type { PtyManager } from '../pty/PtyManager'
import type { PresetStore } from '../store/presetStore'
import type { SettingsStore } from '../store/settingsStore'
import type { WorkspaceStore } from '../store/workspaceStore'

export type Deps = {
  workspaces: WorkspaceStore
  settings: SettingsStore
  presets: PresetStore
  pty: PtyManager
  getWindow: () => BrowserWindow | null
}

export function registerIpcHandlers(deps: Deps): void {
  const { workspaces, settings, presets, pty } = deps

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
    broadcast('workspace:changed', { workspaceId: workspace.id })
    return ok(workspace)
  })

  registerCommand('workspace:update', requestSchemas['workspace:update'], ({ id, patch }) => {
    const updated = workspaces.update(id, patch)
    if (!updated) return fail('NOT_FOUND', 'Workspace not found.')
    broadcast('workspace:changed', { workspaceId: id })
    return ok(updated)
  })

  registerCommand('workspace:delete', requestSchemas['workspace:delete'], ({ id }) => {
    const workspace = workspaces.get(id)
    if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')

    // Kill this workspace's sessions before dropping its configuration, so a
    // deleted workspace cannot leave a running child behind (NFR-08).
    for (const terminal of workspace.terminals) pty.dispose(terminal.id)
    workspaces.delete(id)
    // FR-05: app configuration only — nothing under projectRoot is touched.
    logger.info('workspace.deleted', { id })
    broadcast('workspace:changed', { workspaceId: null })
    return ok({ id })
  })

  /* ---------- terminals ---------- */

  registerCommand(
    'terminal:create',
    requestSchemas['terminal:create'],
    ({ workspaceId, terminalId, cols, rows }) => {
      const workspace = workspaces.get(workspaceId)
      if (!workspace) return fail('NOT_FOUND', 'Workspace not found.')

      const config = workspace.terminals.find((t) => t.id === terminalId)
      if (!config) return fail('NOT_FOUND', 'Terminal configuration not found.')

      const result = pty.create(config, cols, rows)
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
      const config = workspace?.terminals.find((t) => t.id === terminalId)
      if (!config) return fail('NOT_FOUND', 'Terminal configuration not found.')

      pty.dispose(terminalId)
      // Give the OS a tick to release the pipe before rebinding the same id.
      await new Promise((resolve) => setTimeout(resolve, 50))

      const result = pty.create(config, cols, rows)
      if (!result.ok) return { ok: false, error: result.error }
      logger.info('terminal.restarted', { terminalId, pid: result.session.pid })
      return ok(result.session)
    }
  )

  registerCommand('terminal:list-sessions', requestSchemas['terminal:list-sessions'], () =>
    ok(pty.listSessions() as RuntimeSession[])
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

  /* ---------- shells, settings, dialogs ---------- */

  registerCommand('shell:list', requestSchemas['shell:list'], () => ok(discoverShells()))

  registerCommand('settings:get', requestSchemas['settings:get'], () =>
    ok({ settings: settings.get(), resolvedTheme: resolvedTheme() })
  )

  registerCommand('settings:update', requestSchemas['settings:update'], (patch) => {
    const next = settings.update(patch)
    if (patch.themePreference) applyThemePreference(patch.themePreference)
    const theme = resolvedTheme()
    broadcast('theme:changed', { resolvedTheme: theme })
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
