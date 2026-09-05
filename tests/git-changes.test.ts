import { execFileSync } from 'node:child_process'
import * as childProcess from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseGitNumstat, parseGitStatus, readGitChanges, readGitFileDiff } from '../src/main/git/changes'
import { resolveExecutable } from '../src/main/security/paths'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

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
  writeFileSync(join(root, 'removed-from-index.txt'), 'old indexed content\n')
  mkdirSync(join(root, 'nested'))
  writeFileSync(join(root, 'nested', 'inside.txt'), 'inside before\n')
  run('add', '.')
  run('commit', '-m', 'fixture')
  run('rm', '--cached', 'removed-from-index.txt')
  writeFileSync(join(root, 'removed-from-index.txt'), 'replacement\nsecond line\n')

  writeFileSync(join(root, 'modified.txt'), 'before\nafter\n')
  rmSync(join(root, 'deleted.txt'))
  run('mv', 'old-name.txt', 'new-name.txt')
  writeFileSync(join(root, 'mixed.txt'), 'staged\n')
  run('add', 'mixed.txt')
  writeFileSync(join(root, 'mixed.txt'), 'staged\nworking tree\n')
  writeFileSync(join(root, 'untracked file.txt'), 'new file\n')
  writeFileSync(join(root, 'nested', 'inside.txt'), 'inside after\n')
  writeFileSync(join(root, 'outside.txt'), 'outside\n')
  writeFileSync(join(root, 'binary.dat'), Buffer.from([0, 10, 10]))
  writeFileSync(join(root, 'empty.txt'), '')
  writeFileSync(join(root, 'no-newline.txt'), 'one line')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('Git status parsing', () => {
  it('totals numstat records without counting binary files or rename filenames', () => {
    const counts = parseGitNumstat(Buffer.from(['2\t3\tfile', '-\t-\tbinary', '0\t0\t', 'old name', 'new name', '4\t1\twith\ttab', ''].join('\0')))
    expect(counts).toEqual({ additions: 6, deletions: 4 })
  })

  it('ignores a partial numstat record', () => {
    expect(parseGitNumstat(Buffer.from(['2\t1\tfile', '10\t20\tpartial'].join('\0')))).toEqual({ additions: 2, deletions: 1 })
  })
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
  it('disables promisor lazy fetching for every Git child, overriding the inherited environment', async () => {
    const spy = vi.mocked(childProcess.spawn)
    spy.mockClear()
    vi.stubEnv('GIT_NO_LAZY_FETCH', '0')
    try {
      await readGitChanges(git!, root)
      expect(spy.mock.calls.length).toBeGreaterThan(0)
      for (const invocation of spy.mock.calls) {
        expect(invocation[2]).toMatchObject({ env: { GIT_NO_LAZY_FETCH: '1' } })
      }
    } finally {
      spy.mockClear()
      vi.unstubAllEnvs()
    }
  })

  it('combines staged deletion and untracked replacement into one selectable file with both diffs', async () => {
    const snapshot = await readGitChanges(git!, root)
    const entries = snapshot?.files.filter((file) => file.path === 'removed-from-index.txt')
    expect(entries).toHaveLength(1)
    expect(entries?.[0]).toMatchObject({ staged: true, unstaged: true, untracked: true })
    const diff = await readGitFileDiff(git!, root, 'removed-from-index.txt')
    expect(diff.sections.map((section) => section.source)).toEqual(['staged', 'untracked'])
    expect(diff.sections[0]?.patch).toContain('-old indexed content')
    expect(diff.sections[1]?.patch).toContain('+replacement')
  })
  it('sums staged, unstaged and untracked text lines, ignoring empty and binary files', async () => {
    const snapshot = await readGitChanges(git!, root)
    expect(snapshot?.summary).toEqual({ additions: 9, deletions: 3, incomplete: false })
  })

  it('can skip summary work when only loading a file preview', async () => {
    expect((await readGitChanges(git!, root, false))?.summary).toBeUndefined()
  })
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
    expect(snapshot?.summary).toEqual({ additions: 1, deletions: 1, incomplete: false })
  })

  it('marks large untracked files as incomplete in a repository without a first commit', async () => {
    const largeRoot = join(root, 'large-fixture')
    mkdirSync(largeRoot)
    execFileSync(git!, ['-C', largeRoot, 'init'], { stdio: 'ignore' })
    writeFileSync(join(largeRoot, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65))
    const snapshot = await readGitChanges(git!, largeRoot)
    expect(snapshot?.summary).toEqual({ additions: 0, deletions: 0, incomplete: true })
  })

  it('previews an untracked symlink as a link and counts its destination once', async (context) => {
    const linkRoot = join(root, 'symlink-fixture')
    mkdirSync(linkRoot)
    execFileSync(git!, ['-C', linkRoot, 'init'], { stdio: 'ignore' })
    writeFileSync(join(linkRoot, 'target.txt'), 'target content\nsecond\nthird\n')
    try {
      symlinkSync('target.txt', join(linkRoot, 'link.txt'), 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip('File symlink privilege is unavailable')
      throw error
    }
    const diff = await readGitFileDiff(git!, linkRoot, 'link.txt')
    expect(diff.sections[0]?.patch).toContain('new file mode 120000')
    expect(diff.sections[0]?.patch).toContain('+target.txt')
    expect(diff.sections[0]?.patch).not.toContain('+target content')
    expect((await readGitChanges(git!, linkRoot))?.summary).toEqual({ additions: 4, deletions: 0, incomplete: false })
  })
})
