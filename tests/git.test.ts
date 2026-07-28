import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readGitBranch } from '../src/main/git/branch'

const root = mkdtempSync(join(tmpdir(), 'elena-git-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Builds a working tree whose `.git` is a real directory. */
function makeRepo(name: string, head: string): string {
  const repo = join(root, name)
  mkdirSync(join(repo, '.git'), { recursive: true })
  writeFileSync(join(repo, '.git', 'HEAD'), head)
  return repo
}

describe('readGitBranch', () => {
  it('reads the branch name from HEAD', () => {
    const repo = makeRepo('on-branch', 'ref: refs/heads/Version0.1.0\n')
    expect(readGitBranch(repo)).toEqual({ root: repo, branch: 'Version0.1.0', detached: false })
  })

  it('keeps slashes in a namespaced branch', () => {
    const repo = makeRepo('namespaced', 'ref: refs/heads/feature/git-branch-header\n')
    expect(readGitBranch(repo)?.branch).toBe('feature/git-branch-header')
  })

  it('reports a detached HEAD as a short commit id', () => {
    const repo = makeRepo('detached', '5d878f3c1a2b3c4d5e6f708192a3b4c5d6e7f809\n')
    expect(readGitBranch(repo)).toEqual({ root: repo, branch: '5d878f3', detached: true })
  })

  it('walks up from a subdirectory to the working-tree root', () => {
    const repo = makeRepo('nested', 'ref: refs/heads/main\n')
    const deep = join(repo, 'src', 'renderer', 'components')
    mkdirSync(deep, { recursive: true })
    expect(readGitBranch(deep)).toEqual({ root: repo, branch: 'main', detached: false })
  })

  it('follows a gitdir pointer file (worktrees and submodules)', () => {
    const repo = join(root, 'worktree')
    const gitDir = join(root, 'worktree-gitdir')
    mkdirSync(repo, { recursive: true })
    mkdirSync(gitDir, { recursive: true })
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/wt-branch\n')
    writeFileSync(join(repo, '.git'), `gitdir: ${gitDir}\n`)
    expect(readGitBranch(repo)).toEqual({ root: repo, branch: 'wt-branch', detached: false })
  })

  it('resolves a relative gitdir pointer against the working tree', () => {
    const repo = join(root, 'relative-pointer')
    mkdirSync(join(repo, 'actual-git'), { recursive: true })
    writeFileSync(join(repo, 'actual-git', 'HEAD'), 'ref: refs/heads/rel\n')
    writeFileSync(join(repo, '.git'), 'gitdir: ./actual-git\n')
    expect(readGitBranch(repo)?.branch).toBe('rel')
  })

  it('returns null outside a repository', () => {
    const plain = join(root, 'no-repo')
    mkdirSync(plain, { recursive: true })
    // `root` is a temp dir, so nothing above `plain` is a working tree.
    expect(readGitBranch(plain)).toBeNull()
  })

  it('returns null for an unreadable or malformed HEAD instead of guessing', () => {
    const repo = makeRepo('garbled', 'not a ref and not a sha\n')
    expect(readGitBranch(repo)).toBeNull()
  })

  it('rejects an empty path or one containing a NUL byte', () => {
    expect(readGitBranch('')).toBeNull()
    expect(readGitBranch(`${root}\0evil`)).toBeNull()
  })
})
