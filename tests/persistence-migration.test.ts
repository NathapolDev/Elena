/**
 * Tripwire suite: persisted schema versions.
 *
 * This is deliberately NOT a proof that migrations are correct — there is no
 * migration registry to check against. It is a tripwire, and the version pins
 * below are the whole point.
 *
 * `migrateWorkspaceFile` for a file older than the current version spreads the
 * object and bumps the number. It performs no field transformation. So bumping
 * `WORKSPACE_SCHEMA_VERSION` without adding a transform permanently stamps old
 * data as new — the original shape is unrecoverable, on the user's machine, with
 * no error.
 *
 * If a pin below fails: add the field transform to `migrateWorkspaceFile`, add a
 * round-trip fixture here proving old data survives it, and only then update the
 * literal. Never update the literal on its own.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PRESETS_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  workspaceFileSchema
} from '@shared/schemas'
import { loadJsonFile } from '../src/main/store/atomicJson'

describe('schema version tripwire', () => {
  it('pins the workspace schema version', () => {
    expect(WORKSPACE_SCHEMA_VERSION).toBe(2)
  })

  it('pins the settings schema version', () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(2)
  })

  it('pins the presets schema version', () => {
    expect(PRESETS_SCHEMA_VERSION).toBe(1)
  })

  it('still has no field transform to rely on', () => {
    // If this stops being true, migrateWorkspaceFile grew real logic and the
    // comment at the top of this file needs revisiting.
    const source = readFileSync(join(process.cwd(), 'src/main/store/workspaceStore.ts'), 'utf8')
    const migration = source.slice(source.indexOf('function migrateWorkspaceFile'))
    expect(migration.slice(0, 600)).toContain('schemaVersion: WORKSPACE_SCHEMA_VERSION')
  })
})

describe('corrupt file recovery', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'elena-migration-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('backs up unparsable JSON and falls back rather than refusing to start', () => {
    const file = join(dir, 'workspaces.json')
    writeFileSync(file, '{ this is not json', 'utf8')

    const fallback = { schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces: [] }
    const loaded = loadJsonFile(file, workspaceFileSchema, () => fallback)

    expect(loaded.data).toEqual(fallback)
    expect(loaded.recoveredFrom).toContain('.corrupt-')
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toHaveLength(1)
  })

  it('backs up structurally invalid JSON too', () => {
    const file = join(dir, 'workspaces.json')
    writeFileSync(file, JSON.stringify({ schemaVersion: 2, workspaces: 'not-an-array' }), 'utf8')

    const fallback = { schemaVersion: WORKSPACE_SCHEMA_VERSION, workspaces: [] }
    const loaded = loadJsonFile(file, workspaceFileSchema, () => fallback)

    expect(loaded.data).toEqual(fallback)
    expect(loaded.recoveredFrom).toContain('.corrupt-')
    expect(readdirSync(dir).filter((name) => name.includes('.corrupt-'))).toHaveLength(1)
  })
})
