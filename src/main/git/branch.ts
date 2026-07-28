/**
 * Resolves the git branch for a directory by reading `.git` directly.
 *
 * Deliberately does not shell out to `git`: spawning per pane on a timer is
 * expensive, git may not be installed, and it would mean composing a command
 * line for a user-supplied path (NFR-12 — no shell string composition). Reading
 * `HEAD` is a single small file read and gives the same answer.
 *
 * Electron-free so `tests/git.test.ts` can drive it against real fixtures.
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { GitBranchInfo } from '@shared/types'

/** A repo nested more deeply than this is a broken path, not a discovery. */
const MAX_WALK_DEPTH = 64

/** `HEAD` and `.git` pointer files are a single short line; anything larger is not one. */
const MAX_POINTER_BYTES = 8192

function readSmallFile(path: string): string | null {
  try {
    if (statSync(path).size > MAX_POINTER_BYTES) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The git directory for `dir`, if it has one. `.git` is a directory in a normal
 * clone and a `gitdir: <path>` pointer file in a worktree or submodule.
 */
function gitDirFor(dir: string): string | null {
  const dotGit = join(dir, '.git')
  let stats
  try {
    stats = statSync(dotGit)
  } catch {
    return null
  }
  if (stats.isDirectory()) return dotGit
  if (!stats.isFile()) return null

  const pointer = readSmallFile(dotGit)
  const target = pointer?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1]
  if (!target) return null
  return isAbsolute(target) ? resolve(target) : resolve(dir, target)
}

function headOf(gitDir: string): Pick<GitBranchInfo, 'branch' | 'detached'> | null {
  const head = readSmallFile(join(gitDir, 'HEAD'))?.trim()
  if (!head) return null

  const ref = head.match(/^ref:\s*(.+?)$/)?.[1]
  if (ref) {
    const branch = ref.replace(/^refs\/heads\//, '').trim()
    return branch ? { branch, detached: false } : null
  }
  // Detached HEAD stores the raw commit id.
  if (/^[0-9a-f]{7,64}$/i.test(head)) return { branch: head.slice(0, 7), detached: true }
  return null
}

/**
 * Walks up from `dir` looking for a working tree. The walk crosses the
 * workspace project root on purpose — a workspace often points at a subfolder
 * of the repo — but it only ever *reads* `.git` metadata, never anything else
 * and never writes (FR-05).
 */
export function readGitBranch(dir: string): GitBranchInfo | null {
  if (typeof dir !== 'string' || dir.trim().length === 0 || dir.includes('\0')) return null

  let current = resolve(dir)
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    const gitDir = gitDirFor(current)
    if (gitDir) {
      const head = headOf(gitDir)
      // A repo mid-clone has `.git` but no readable HEAD yet; report nothing
      // rather than keep walking into an unrelated parent repo.
      return head ? { root: current, ...head } : null
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}
