/**
 * Atomic persistence and corrupted-file recovery (FR-03, FR-04, NFR-07).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadJsonFile, writeJsonFileAtomic } from '../src/main/store/atomicJson'
import { PresetStore } from '../src/main/store/presetStore'
import { SettingsStore } from '../src/main/store/settingsStore'
import { WorkspaceStore } from '../src/main/store/workspaceStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elena-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const schema = z.object({ schemaVersion: z.number(), value: z.string() })

describe('atomic json', () => {
  it('round-trips a valid file', () => {
    const file = join(dir, 'data.json')
    writeJsonFileAtomic(file, { schemaVersion: 1, value: 'hello' })
    const outcome = loadJsonFile(file, schema, () => ({ schemaVersion: 1, value: 'fallback' }))
    expect(outcome.data.value).toBe('hello')
    expect(outcome.recoveredFrom).toBeUndefined()
  })

  it('leaves no temp files behind', () => {
    const file = join(dir, 'data.json')
    writeJsonFileAtomic(file, { schemaVersion: 1, value: 'hello' })
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toHaveLength(0)
  })

  it('backs up an unparseable file and falls back', () => {
    const file = join(dir, 'data.json')
    writeFileSync(file, '{ this is not json')
    const outcome = loadJsonFile(file, schema, () => ({ schemaVersion: 1, value: 'fallback' }))
    expect(outcome.data.value).toBe('fallback')
    expect(outcome.recoveredFrom).toBeTruthy()
    expect(existsSync(outcome.recoveredFrom!)).toBe(true)
  })

  it('backs up a schema-invalid file rather than trusting it', () => {
    const file = join(dir, 'data.json')
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, value: 42 }))
    const outcome = loadJsonFile(file, schema, () => ({ schemaVersion: 1, value: 'fallback' }))
    expect(outcome.data.value).toBe('fallback')
    expect(outcome.recoveredFrom).toBeTruthy()
  })

  it('starts from the fallback when no file exists yet', () => {
    const outcome = loadJsonFile(join(dir, 'missing.json'), schema, () => ({
      schemaVersion: 1,
      value: 'fallback'
    }))
    expect(outcome.data.value).toBe('fallback')
    expect(outcome.recoveredFrom).toBeUndefined()
  })
})

describe('transactional stores', () => {
  it('does not apply a settings update when its file cannot be written', () => {
    const blocker = join(dir, 'not-a-directory')
    writeFileSync(blocker, 'x')
    const store = new SettingsStore(join(blocker, 'settings.json'))
    store.load()

    expect(() => store.update({ themePreference: 'light' })).toThrow()
    expect(store.get().themePreference).toBe('system')
  })

  it('does not add a preset when its file cannot be written', () => {
    const blocker = join(dir, 'not-a-directory')
    writeFileSync(blocker, 'x')
    const store = new PresetStore(join(blocker, 'presets.json'))
    store.load()
    const before = store.list()

    expect(() =>
      store.create({
        name: 'Unsaved',
        executable: 'cmd.exe',
        args: [],
        defaultCwd: '',
        envAllowlist: []
      })
    ).toThrow()
    expect(store.list()).toEqual(before)
  })
})

describe('WorkspaceStore', () => {
  it('creates, updates and reloads a workspace', () => {
    const file = join(dir, 'workspaces.json')
    const store = new WorkspaceStore(file)
    store.load()

    const created = store.create('Demo', dir)
    store.update(created.id, {
      terminals: [
        {
          id: 't1',
          title: 'PowerShell',
          executable: 'powershell.exe',
          args: [],
          cwd: dir,
          envAllowlist: []
        }
      ],
      layout: { type: 'terminal', terminalId: 't1' },
      activeTerminalId: 't1'
    })
    store.saveNow()

    const reloaded = new WorkspaceStore(file)
    reloaded.load()
    const workspace = reloaded.get(created.id)
    expect(workspace?.name).toBe('Demo')
    expect(workspace?.terminals).toHaveLength(1)
    expect(workspace?.layout).toEqual({ type: 'terminal', terminalId: 't1' })
  })

  it('prunes layout leaves whose terminal is gone', () => {
    const file = join(dir, 'workspaces.json')
    const store = new WorkspaceStore(file)
    store.load()
    const created = store.create('Demo', dir)

    const updated = store.update(created.id, {
      terminals: [],
      layout: { type: 'terminal', terminalId: 'ghost' }
    })
    expect(updated?.layout).toBeNull()
  })

  it('migrates a schema v1 workspace without losing its layout', () => {
    const file = join(dir, 'workspaces.json')
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        workspaces: [
          {
            id: 'w1', name: 'Legacy', projectRoot: dir,
            layout: { type: 'terminal', terminalId: 't1' },
            terminals: [{ id: 't1', title: 'Shell', executable: 'pwsh.exe', args: [], cwd: dir, envAllowlist: [] }],
            activeTerminalId: 't1', createdAt: '2026-01-01', updatedAt: '2026-01-01'
          }
        ]
      })
    )
    const store = new WorkspaceStore(file)
    store.load()
    expect(store.get('w1')?.layout).toEqual({ type: 'terminal', terminalId: 't1' })
    store.saveNow()
    expect(JSON.parse(readFileSync(file, 'utf8')).schemaVersion).toBe(2)
  })

  it('deleting a workspace does not touch the project folder', () => {
    const file = join(dir, 'workspaces.json')
    const marker = join(dir, 'important.txt')
    writeFileSync(marker, 'keep me')

    const store = new WorkspaceStore(file)
    store.load()
    const created = store.create('Demo', dir)
    expect(store.delete(created.id)).toBe(true)
    store.saveNow()

    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(marker, 'utf8')).toBe('keep me')
    expect(store.list()).toHaveLength(0)
  })

  it('recovers from a corrupt workspace file instead of failing to start', () => {
    const file = join(dir, 'workspaces.json')
    writeFileSync(file, 'not json at all')
    const store = new WorkspaceStore(file)
    store.load()
    expect(store.list()).toEqual([])
    expect(store.getRecoveryNotice()).toBeTruthy()
  })
})
