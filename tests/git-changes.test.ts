import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseGitStatus, readGitChanges, readGitFileDiff } from '../src/main/git/changes'
import { resolveExecutable } from '../src/main/security/paths'

const root = mkdtempSync(join(tmpdir(), 'elena-git-changes-'))
const git = resolveExecutable('git')

function run(...args: string[]): void {
  if (!git) throw new Error('Git is required for this test fixture.')
  execFileSync(git, ['-C', root, ...args], { stdio: 'ignore' })
}

beforeAll(() => {
  if (!git) throw new Error('Git is required for Git changes tests.')
  run('init')
  run('config', 'user.name', 'Elena Tests')
  run('config', 'user.email', 'elena@example.invalid')
  writeFileSync(join(root, 'modified.txt'), 'before\n')
  writeFileSync(join(root, 'deleted.txt'), 'delete me\n')
  writeFileSync(join(root, 'old-name.txt'), 'rename me\n')
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'nested', 'inside.txt'), 'inside before\n')
  run('add', '.')
  run('commit', '-m', 'fixture')

  writeFileSync(join(root, 'modified.txt'), 'before\nafter\n')
  rmSync(join(root, 'deleted.txt'))
  run('mv', 'old-name.txt', 'new-name.txt')
  writeFileSync(join(root, 'mixed.txt'), 'staged\n')
  run('add', 'mixed.txt')
  writeFileSync(join(root, 'mixed.txt'), 'staged\nworking tree\n')
  writeFileSync(join(root, 'untracked file.txt'), 'new file\n')
  writeFileSync(join(root, 'nested', 'inside.txt'), 'inside after\n')
  writeFileSync(join(root, 'outside.txt'), 'outside\n')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('Git status parsing', () => {
  it('parses NUL-delimited rename records and paths with spaces', () => {
    const output = Buffer.from('R  new name.txt\0old name.txt\0?? loose file.txt\0')
    const files = parseGitStatus(output, root, root)

    expect(files).toMatchObject([
      { path: 'loose file.txt', kind: 'untracked', staged: false, unstaged: true },
      { path: 'new name.txt', previousPath: 'old name.txt', kind: 'renamed', staged: true }
    ])
  })

  it('drops a partial final record from bounded output', () => {
    expect(parseGitStatus(Buffer.from('?? complete.txt\0?? partial'), root, root)).toHaveLength(1)
  })
})

describe.runIf(Boolean(git))('Git changes service', () => {
  it('reports staged, unstaged, untracked, deleted and renamed files', async () => {
    const snapshot = await readGitChanges(git!, root)
    const byPath = new Map(snapshot?.files.map((file) => [file.path, file]))

    expect(byPath.get('modified.txt')).toMatchObject({ kind: 'modified', staged: false, unstaged: true })
    expect(byPath.get('mixed.txt')).toMatchObject({ kind: 'added', staged: true, unstaged: true })
    expect(byPath.get('untracked file.txt')).toMatchObject({ kind: 'untracked', openable: true })
    expect(byPath.get('deleted.txt')).toMatchObject({ kind: 'deleted', openable: false })
    expect(byPath.get('new-name.txt')).toMatchObject({
      kind: 'renamed',
      previousPath: 'old-name.txt',
      staged: true
    })
  })

  it('returns separate staged and working-tree diff sections', async () => {
    const diff = await readGitFileDiff(git!, root, 'mixed.txt')

    expect(diff.sections.map((section) => section.source)).toEqual(['staged', 'working-tree'])
    expect(diff.sections[0]?.patch).toContain('+staged')
    expect(diff.sections[1]?.patch).toContain('+working tree')
  })

  it('builds a new-file patch for an untracked file', async () => {
    const diff = await readGitFileDiff(git!, root, 'untracked file.txt')

    expect(diff.sections).toHaveLength(1)
    expect(diff.sections[0]).toMatchObject({ source: 'untracked', binary: false })
    expect(diff.sections[0]?.patch).toContain('+new file')
  })

  it('limits a nested workspace to its own subtree', async () => {
    const snapshot = await readGitChanges(git!, join(root, 'nested'))

    expect(snapshot?.files.map((file) => file.path)).toEqual(['inside.txt'])
  })
})
