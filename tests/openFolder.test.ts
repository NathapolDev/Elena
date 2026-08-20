/**
 * The Explorer "Open in Elena" path: argv → folder → workspace.
 *
 * The rule under test is the one the user sees — a folder that already has a
 * workspace reuses it, a folder that does not gets one — plus the argv contract
 * shared with the installer and the registry entries.
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OPEN_FOLDER_FLAG, parseOpenFolderArg } from '../src/main/shell/openFolderArgs'
import { openFolderWorkspace } from '../src/main/shell/openFolder'
import { SCRATCH_WORKSPACE_ID, WorkspaceStore } from '../src/main/store/workspaceStore'

describe('parseOpenFolderArg', () => {
  it('reads the space-separated form Explorer produces', () => {
    expect(parseOpenFolderArg(['C:\\Elena.exe', OPEN_FOLDER_FLAG, 'C:\\Projects\\My App'])).toBe(
      'C:\\Projects\\My App'
    )
  })

  it('reads the = form', () => {
    expect(parseOpenFolderArg(['elena', '--open-folder=C:\\Projects\\App'])).toBe('C:\\Projects\\App')
  })

  it('ignores a launch that does not carry the flag', () => {
    expect(parseOpenFolderArg(['C:\\Elena.exe', '--no-sandbox', '.'])).toBeNull()
  })

  it('does not swallow the next switch as a path', () => {
    expect(parseOpenFolderArg(['elena', OPEN_FOLDER_FLAG, '--inspect'])).toBeNull()
  })

  it('treats a valueless flag as absent', () => {
    expect(parseOpenFolderArg(['elena', OPEN_FOLDER_FLAG])).toBeNull()
    expect(parseOpenFolderArg(['elena', '--open-folder='])).toBeNull()
  })
})

describe('openFolderWorkspace', () => {
  let dir: string
  let store: WorkspaceStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'elena-open-folder-'))
    store = new WorkspaceStore(join(dir, 'workspaces.json'))
    store.load()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function folder(name: string): string {
    const path = join(dir, name)
    mkdirSync(path, { recursive: true })
    return path
  }

  it('creates a workspace named after the folder when none matches', () => {
    const project = folder('my-app')

    const outcome = openFolderWorkspace(store, project)

    expect(outcome).toMatchObject({ ok: true, created: true })
    const created = store.list()
    expect(created).toHaveLength(1)
    expect(created[0]?.name).toBe('my-app')
    // FR-14: opening a folder is configuration, never a running session.
    expect(created[0]?.terminals).toEqual([])
    expect(created[0]?.layout).toBeNull()
  })

  it('reuses the existing workspace for a folder', () => {
    const project = folder('my-app')
    const existing = store.create('Anything', project)

    const outcome = openFolderWorkspace(store, project)

    expect(outcome).toEqual({ ok: true, workspaceId: existing.id, created: false })
    expect(store.list()).toHaveLength(1)
  })

  it('matches a path Explorer hands over with a trailing separator', () => {
    const project = folder('my-app')
    const existing = store.create('My App', project)

    expect(openFolderWorkspace(store, project + sep)).toEqual({
      ok: true,
      workspaceId: existing.id,
      created: false
    })
  })

  it('gives the home folder its own workspace instead of reusing Quick Session', () => {
    const project = folder('home')
    store.ensureScratch(project)

    const outcome = openFolderWorkspace(store, project)

    expect(outcome).toMatchObject({ ok: true, created: true })
    expect(outcome).not.toMatchObject({ workspaceId: SCRATCH_WORKSPACE_ID })
  })

  it('prefers a real workspace over the scratch one on the same folder', () => {
    const project = folder('shared-root')
    store.ensureScratch(project)
    const real = store.create('Shared Root', project)

    expect(openFolderWorkspace(store, project)).toEqual({
      ok: true,
      workspaceId: real.id,
      created: false
    })
    expect(real.id).not.toBe(SCRATCH_WORKSPACE_ID)
  })

  it('rejects a folder that is gone instead of creating a workspace for it', () => {
    const outcome = openFolderWorkspace(store, join(dir, 'does-not-exist'))

    expect(outcome).toEqual({ ok: false, reason: 'missing' })
    expect(store.list()).toHaveLength(0)
  })

  it('rejects a relative path, which is never what Explorer sends', () => {
    expect(openFolderWorkspace(store, 'my-app')).toEqual({ ok: false, reason: 'not-absolute' })
    expect(store.list()).toHaveLength(0)
  })
})
