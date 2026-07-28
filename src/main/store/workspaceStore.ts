/**
 * Workspace persistence (FR-01..FR-05).
 *
 * Deleting a workspace removes app configuration only — nothing under
 * projectRoot is ever touched (FR-05).
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { WORKSPACE_SCHEMA_VERSION, workspaceFileSchema } from '@shared/schemas'
import { pruneLayout } from '@shared/layout'
import type { LayoutNode, TerminalConfig, Workspace } from '@shared/types'
import { loadJsonFile, writeJsonFileAtomic } from './atomicJson'
import { logger } from '../logger'

const SAVE_DEBOUNCE_MS = 400 // FR-03: no more than 1s

type WorkspaceFile = {
  schemaVersion: number
  workspaces: Workspace[]
}

export type WorkspaceUpdate = {
  name?: string
  layout?: LayoutNode | null
  terminals?: TerminalConfig[]
  activeTerminalId?: string | null
}

export class WorkspaceStore {
  private file: WorkspaceFile = { schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces: [] }
  private saveTimer: NodeJS.Timeout | null = null
  private recoveredFrom: string | undefined

  constructor(private readonly filePath = join(app.getPath('userData'), 'workspaces.json')) {}

  load(): void {
    const outcome = loadJsonFile<WorkspaceFile>(
      this.filePath,
      workspaceFileSchema,
      () => ({ schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces: [] }),
      migrateWorkspaceFile
    )
    this.file = outcome.data
    this.recoveredFrom = outcome.recoveredFrom
    // A layout may reference a terminal that no longer exists after a manual
    // edit or a failed write; drop those leaves rather than render a ghost pane.
    for (const workspace of this.file.workspaces) {
      const ids = workspace.terminals.map((t) => t.id)
      workspace.layout = pruneLayout(workspace.layout, ids)
    }
    logger.info('workspace.loaded', {
      count: this.file.workspaces.length,
      recovered: Boolean(outcome.recoveredFrom)
    })
  }

  /** Set when the previous file had to be backed up, so the UI can warn once. */
  getRecoveryNotice(): string | undefined {
    return this.recoveredFrom
  }

  list(): Workspace[] {
    return this.file.workspaces.map(clone)
  }

  get(id: string): Workspace | undefined {
    const found = this.file.workspaces.find((w) => w.id === id)
    return found ? clone(found) : undefined
  }

  create(name: string, projectRoot: string): Workspace {
    const now = new Date().toISOString()
    const workspace: Workspace = {
      id: randomUUID(),
      name,
      projectRoot,
      layout: null,
      terminals: [],
      createdAt: now,
      updatedAt: now
    }
    this.file.workspaces.push(workspace)
    this.scheduleSave()
    return clone(workspace)
  }

  update(id: string, patch: WorkspaceUpdate): Workspace | undefined {
    const workspace = this.file.workspaces.find((w) => w.id === id)
    if (!workspace) return undefined

    if (patch.name !== undefined) workspace.name = patch.name
    if (patch.terminals !== undefined) workspace.terminals = patch.terminals
    if (patch.layout !== undefined) workspace.layout = patch.layout
    if (patch.activeTerminalId !== undefined) {
      if (patch.activeTerminalId === null) delete workspace.activeTerminalId
      else workspace.activeTerminalId = patch.activeTerminalId
    }
    workspace.layout = pruneLayout(
      workspace.layout,
      workspace.terminals.map((t) => t.id)
    )
    workspace.updatedAt = new Date().toISOString()
    this.scheduleSave()
    return clone(workspace)
  }

  delete(id: string): boolean {
    const index = this.file.workspaces.findIndex((w) => w.id === id)
    if (index === -1) return false
    this.file.workspaces.splice(index, 1)
    this.scheduleSave()
    return true
  }

  /** Coalesces bursts of layout changes into one write (FR-03). */
  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      writeJsonFileAtomic(this.filePath, this.file)
    } catch (error) {
      logger.error('workspace.save-failed', { error })
      throw error
    }
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Bumps older files forward. Unknown/newer versions are left to schema validation. */
function migrateWorkspaceFile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const file = raw as Record<string, unknown>
  if (typeof file.schemaVersion !== 'number') {
    return { schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces: file.workspaces ?? [] }
  }
  if (file.schemaVersion < WORKSPACE_SCHEMA_VERSION) {
    return { ...file, schemaVersion: WORKSPACE_SCHEMA_VERSION }
  }
  return file
}
