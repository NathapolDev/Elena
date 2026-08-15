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
import { SCRATCH_WORKSPACE_ID, WorkspaceStore } from '../src/main/store/workspaceStore'

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

  it('migrates settings v1 with the original terminal typography defaults', () => {
    const file = join(dir, 'settings.json')
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 1,
        settings: {
          themePreference: 'light',
          scrollback: 20_000,
          confirmCloseRunning: false,
          warnOnMultilinePaste: false,
          defaultShellId: 'pwsh'
        }
      })
    )

    const store = new SettingsStore(file)
    store.load()

    expect(store.get()).toMatchObject({
      themePreference: 'light',
      scrollback: 20_000,
      terminalFontFamily: null,
      terminalFontSize: 13,
      terminalLineHeight: 1.2
    })

    store.update({ terminalFontSize: 15 })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      schemaVersion: 2,
      settings: { themePreference: 'light', scrollback: 20_000, terminalFontSize: 15 }
    })
  })

  it('repairs a v2 file an older build stripped the typography fields out of', () => {
    // 0.1.0 accepts schemaVersion 2, drops the fields its schema does not know,
    // and rewrites the file still stamped 2. Migrating on the version alone
    // would let that file through unchanged, fail the v2 schema, and take the
    // user's theme and scrollback down with it as "corrupt".
    const file = join(dir, 'settings.json')
    writeFileSync(
      file,
      JSON.stringify({
        schemaVersion: 2,
        settings: {
          themePreference: 'dark',
          scrollback: 30_000,
          confirmCloseRunning: false,
          warnOnMultilinePaste: false,
          defaultShellId: 'pwsh'
        }
      })
    )

    const store = new SettingsStore(file)
    store.load()

    expect(store.get()).toMatchObject({
      themePreference: 'dark',
      scrollback: 30_000,
      defaultShellId: 'pwsh',
      terminalFontFamily: null,
      terminalFontSize: 13,
      terminalLineHeight: 1.2
    })
    expect(readdirSync(dir).filter((name) => name.includes('corrupt'))).toEqual([])
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

  it('ensureScratch is idempotent and keeps a stable id', () => {
    const file = join(dir, 'workspaces.json')
    const store = new WorkspaceStore(file)
    store.load()

    const first = store.ensureScratch(dir)
    const second = store.ensureScratch(dir)
    expect(second.id).toBe(first.id)
    expect(first.id).toBe(SCRATCH_WORKSPACE_ID)
    expect(store.list()).toHaveLength(1)

    // The id has to survive a reload, or a relaunch would start a second one.
    store.saveNow()
    const reloaded = new WorkspaceStore(file)
    reloaded.load()
    expect(reloaded.ensureScratch(dir).id).toBe(SCRATCH_WORKSPACE_ID)
    expect(reloaded.list()).toHaveLength(1)
  })

  it('ensureScratch never clobbers a scratch workspace that already has sessions', () => {
    const file = join(dir, 'workspaces.json')
    const store = new WorkspaceStore(file)
    store.load()

    const scratch = store.ensureScratch(dir)
    store.update(scratch.id, {
      terminals: [{ id: 't1', title: 'Claude Code', executable: 'pwsh.exe', args: [], cwd: dir, envAllowlist: [] }],
      layout: { type: 'terminal', terminalId: 't1' }
    })

    const again = store.ensureScratch(dir)
    expect(again.terminals).toHaveLength(1)
    expect(again.layout).toEqual({ type: 'terminal', terminalId: 't1' })
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
