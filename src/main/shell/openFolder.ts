/**
 * Turning an Explorer "Open in Elena" click into a workspace.
 *
 * The rule the user sees: a folder that already has a workspace reuses it, a
 * folder that does not gets one named after itself. Nothing is started — a
 * restored session is configuration, not a process (FR-14) — so this only ever
 * decides *which* workspace the window should land on.
 */
import { basename } from 'node:path'
import type { PathCheck } from '../security/paths'
import { isSamePath, validateDirectory } from '../security/paths'
import type { WorkspaceStore } from '../store/workspaceStore'
import { SCRATCH_WORKSPACE_ID } from '../store/workspaceStore'
import { logger } from '../logger'

type PathRejection = Extract<PathCheck, { ok: false }>['reason']

export type OpenFolderOutcome =
  | { ok: true; workspaceId: string; created: boolean }
  | { ok: false; reason: PathRejection }

export function openFolderWorkspace(workspaces: WorkspaceStore, rawPath: string): OpenFolderOutcome {
  const check = validateDirectory(rawPath)
  if (!check.ok) {
    // NFR-09: the reason is metadata; the path the user right-clicked is not.
    logger.warn('shell.open-folder-rejected', { reason: check.reason })
    return { ok: false, reason: check.reason }
  }

  // Quick Session is deliberately not a match. It sits on the home folder and
  // `ensureScratch` may repair its project root out from under the user, so
  // right-clicking that folder gets a workspace of its own instead.
  const existing = workspaces
    .list()
    .find(
      (workspace) => workspace.id !== SCRATCH_WORKSPACE_ID && isSamePath(workspace.projectRoot, check.path)
    )
  if (existing) return { ok: true, workspaceId: existing.id, created: false }

  // A drive root has no basename, so fall back to the path itself for a name.
  const workspace = workspaces.create(basename(check.path) || check.path, check.path)
  logger.info('workspace.created', { id: workspace.id, source: 'shell' })
  return { ok: true, workspaceId: workspace.id, created: true }
}
