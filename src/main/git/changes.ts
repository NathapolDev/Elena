/**
 * Bounded, read-only Git status and diff operations.
 *
 * Git is always spawned as an executable plus argv. Repository-provided diff
 * helpers, textconv commands and fsmonitor hooks are disabled so inspecting an
 * untrusted workspace cannot execute its configuration.
 */
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import type {
  GitChangeEntry,
  GitChangeKind,
  GitChangesSnapshot,
  GitDiffSection,
  GitFileDiff
} from '@shared/types'
import { isInside, validateFile } from '../security/paths'
import { readGitBranch } from './branch'

const STATUS_OUTPUT_LIMIT = 4 * 1024 * 1024
const DIFF_OUTPUT_LIMIT = 2 * 1024 * 1024
const STDERR_LIMIT = 8192
const MAX_CHANGE_ENTRIES = 1000
const GIT_TIMEOUT_MS = 15_000

type GitOutput = { stdout: Buffer; truncated: boolean }

export class GitPathNotChangedError extends Error {
  constructor() {
    super('The file is no longer changed.')
    this.name = 'GitPathNotChangedError'
  }
}

function boundedAppend(parts: Buffer[], chunk: Buffer, current: number, limit: number): number {
  const remaining = limit - current
  if (remaining > 0) parts.push(chunk.subarray(0, remaining))
  return current + Math.min(chunk.length, Math.max(remaining, 0))
}

function runGit(
  executable: string,
  root: string,
  args: readonly string[],
  maxOutput: number,
  acceptedExitCodes: readonly number[] = [0]
): Promise<GitOutput> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      executable,
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args],
      {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' }
      }
    )
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, GIT_TIMEOUT_MS)

    child.stdout.on('data', (value: Buffer) => {
      if (stdoutBytes >= maxOutput) {
        truncated = true
        child.kill()
        return
      }
      const remaining = maxOutput - stdoutBytes
      stdoutBytes = boundedAppend(stdout, value, stdoutBytes, maxOutput)
      if (value.length > remaining) {
        truncated = true
        child.kill()
      }
    })
    child.stderr.on('data', (value: Buffer) => {
      stderrBytes = boundedAppend(stderr, value, stderrBytes, STDERR_LIMIT)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error('Git operation timed out.'))
        return
      }
      if (!truncated && (code === null || !acceptedExitCodes.includes(code))) {
        reject(new Error(`Git exited with code ${code ?? 'unknown'}.`))
        return
      }
      resolvePromise({ stdout: Buffer.concat(stdout), truncated })
    })
  })
}

function slash(path: string): string {
  return path.split(sep).join('/')
}

function toWorkspacePath(repositoryRoot: string, workspaceRoot: string, gitPath: string): string | null {
  const absolute = resolve(repositoryRoot, gitPath)
  if (!isInside(workspaceRoot, absolute)) return null
  const result = slash(relative(workspaceRoot, absolute))
  return result && result !== '..' && !result.startsWith('../') ? result : null
}

function classify(x: string, y: string): GitChangeKind {
  if (x === '?' && y === '?') return 'untracked'
  if (x === 'U' || y === 'U' || ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(x + y)) {
    return 'conflicted'
  }
  if (x === 'R' || y === 'R') return 'renamed'
  if (x === 'C' || y === 'C') return 'copied'
  if (y === 'D' || x === 'D') return 'deleted'
  if (x === 'A' || y === 'A') return 'added'
  return 'modified'
}

function isOpenable(workspaceRoot: string, path: string): boolean {
  try {
    if (!statSync(resolve(workspaceRoot, path)).isFile()) return false
  } catch {
    return false
  }
  return validateFile(path, workspaceRoot).ok
}

export function parseGitStatus(
  output: Buffer,
  repositoryRoot: string,
  workspaceRoot: string,
  checkOpenable = true
): GitChangeEntry[] {
  const records = output.toString('utf8').split('\0')
  if (output.length > 0 && output[output.length - 1] !== 0) records.pop()
  const files: GitChangeEntry[] = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.length < 4) continue
    const x = record[0] ?? ' '
    const y = record[1] ?? ' '
    if (x === '!' && y === '!') continue

    const rawPath = record.slice(3)
    const renameOrCopy = x === 'R' || x === 'C' || y === 'R' || y === 'C'
    const rawPreviousPath = renameOrCopy ? records[++index] : undefined
    const path = toWorkspacePath(repositoryRoot, workspaceRoot, rawPath)
    if (!path) continue
    const previousPath = rawPreviousPath
      ? toWorkspacePath(repositoryRoot, workspaceRoot, rawPreviousPath) ?? undefined
      : undefined

    files.push({
      path,
      ...(previousPath ? { previousPath } : {}),
      kind: classify(x, y),
      staged: x !== ' ' && x !== '?',
      unstaged: x === '?' || y !== ' ',
      openable: checkOpenable && isOpenable(workspaceRoot, path)
    })
  }

  return files.toSorted((a, b) => a.path.localeCompare(b.path))
}

function workspacePathspec(repositoryRoot: string, workspaceRoot: string): string {
  const prefix = slash(relative(repositoryRoot, workspaceRoot))
  return prefix || '.'
}

function repositoryPath(repositoryRoot: string, workspaceRoot: string, path: string): string {
  return slash(relative(repositoryRoot, resolve(workspaceRoot, path)))
}

export async function readGitChanges(
  executable: string,
  workspaceRoot: string,
  includeSummary = true
): Promise<GitChangesSnapshot | null> {
  const repository = readGitBranch(workspaceRoot)
  if (!repository) return null

  const result = await runGit(
    executable,
    repository.root,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', workspacePathspec(repository.root, workspaceRoot)],
    STATUS_OUTPUT_LIMIT
  )
  const parsed = parseGitStatus(result.stdout, repository.root, workspaceRoot, false)
  const files = parsed.slice(0, MAX_CHANGE_ENTRIES)
  // Yield between small batches of path checks so a large repository cannot
  // monopolize main while terminal output is waiting to be flushed.
  for (let index = 0; index < files.length; index += 1) {
    if (index % 8 === 0) await new Promise<void>((done) => setImmediate(done))
    const file = files[index]!
    file.openable = isOpenable(workspaceRoot, file.path)
  }
  const snapshot: GitChangesSnapshot = {
    repository,
    files,
    truncated: result.truncated || parsed.length > MAX_CHANGE_ENTRIES
  }
  if (includeSummary) snapshot.summary = await readChangeSummary(executable, workspaceRoot, snapshot)
  return snapshot
}

export function parseGitNumstat(output: Buffer): { additions: number; deletions: number } {
  const records = output.toString('utf8').split('\0')
  if (output.length > 0 && output[output.length - 1] !== 0) records.pop()
  let additions = 0
  let deletions = 0
  for (let index = 0; index < records.length; index += 1) {
    const match = records[index]?.match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/)
    if (!match) continue
    if (match[1] !== '-' && match[2] !== '-') {
      additions += Number(match[1])
      deletions += Number(match[2])
    }
    // With -z, a rename has an empty path followed by two NUL-delimited names.
    if (match[3] === '') index += 2
  }
  return { additions, deletions }
}

async function readChangeSummary(
  executable: string,
  workspaceRoot: string,
  snapshot: GitChangesSnapshot
): Promise<NonNullable<GitChangesSnapshot['summary']>> {
  const summary = { additions: 0, deletions: 0, incomplete: snapshot.truncated }
  const prefix = workspacePathspec(snapshot.repository.root, workspaceRoot)
  const results = await Promise.all([false, true].map((cached) => runGit(
    executable,
    snapshot.repository.root,
    ['diff', '--numstat', '-z', '--no-ext-diff', '--no-textconv', '--find-renames',
      ...(cached ? ['--cached'] : []), '--', `:(literal)${prefix}`],
    STATUS_OUTPUT_LIMIT
  )))
  for (const result of results) {
    const counts = parseGitNumstat(result.stdout)
    summary.additions += counts.additions
    summary.deletions += counts.deletions
    summary.incomplete ||= result.truncated
  }

  // Untracked text has no index entry. Bound all asynchronous reads to 16 MiB
  // per summary and 2 MiB per file; never spawn a Git process per loose file.
  let remaining = 16 * 1024 * 1024
  for (const change of snapshot.files) {
    if (change.kind !== 'untracked') continue
    const file = validateFile(change.path, workspaceRoot)
    if (!file.ok || remaining <= 0) {
      summary.incomplete = true
      continue
    }
    try {
      const handle = await open(file.path, 'r')
      try {
        const size = (await handle.stat()).size
        if (size > Math.min(remaining, DIFF_OUTPUT_LIMIT)) {
          summary.incomplete = true
          continue
        }
        const data = Buffer.alloc(size)
        let length = 0
        while (length < size) {
          const { bytesRead } = await handle.read(data, length, size - length, length)
          if (bytesRead === 0) break
          length += bytesRead
        }
        remaining -= size
        if (data.subarray(0, Math.min(length, 8000)).includes(0)) continue
        for (let index = 0; index < length; index += 1) {
          if (data[index] === 10) summary.additions += 1
        }
        if (length > 0 && data[length - 1] !== 10) summary.additions += 1
      } finally {
        await handle.close()
      }
    } catch {
      summary.incomplete = true
    }
  }
  return summary
}

function binaryPatch(patch: string): boolean {
  return /^Binary files .+ differ$/m.test(patch) || patch.includes('GIT binary patch')
}

async function diffSection(
  executable: string,
  repositoryRoot: string,
  workspacePrefix: string,
  args: readonly string[],
  source: GitDiffSection['source'],
  maxOutput: number,
  acceptedExitCodes: readonly number[] = [0]
): Promise<GitDiffSection> {
  const result = await runGit(
    executable,
    repositoryRoot,
    [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--find-renames',
      '--unified=3',
      ...(workspacePrefix === '.' ? [] : [`--relative=${workspacePrefix}`]),
      ...args
    ],
    maxOutput,
    acceptedExitCodes
  )
  const patch = result.stdout.toString('utf8')
  return { source, patch, binary: binaryPatch(patch), truncated: result.truncated }
}

export async function readGitFileDiff(
  executable: string,
  workspaceRoot: string,
  requestedPath: string
): Promise<GitFileDiff> {
  const snapshot = await readGitChanges(executable, workspaceRoot, false)
  const change = snapshot?.files.find((file) => file.path === requestedPath)
  if (!snapshot || !change) throw new GitPathNotChangedError()

  const repositoryRoot = snapshot.repository.root
  const prefix = workspacePathspec(repositoryRoot, workspaceRoot)
  const paths = [change.path, change.previousPath]
    .filter((path): path is string => Boolean(path))
    .map((path) => repositoryPath(repositoryRoot, workspaceRoot, path))
  const sections: GitDiffSection[] = []
  let remaining = DIFF_OUTPUT_LIMIT

  if (change.kind === 'untracked') {
    const file = validateFile(change.path, workspaceRoot)
    if (!file.ok) throw new GitPathNotChangedError()
    const section = await diffSection(
      executable,
      repositoryRoot,
      '.',
      ['--no-index', '--', 'NUL', file.path],
      'untracked',
      remaining,
      [0, 1]
    )
    sections.push(section)
  } else {
    if (change.staged && remaining > 0) {
      const section = await diffSection(
        executable,
        repositoryRoot,
        prefix,
        ['--cached', '--', ...paths],
        'staged',
        remaining
      )
      sections.push(section)
      remaining -= Buffer.byteLength(section.patch)
    }
    if (change.unstaged && remaining > 0) {
      const section = await diffSection(
        executable,
        repositoryRoot,
        prefix,
        ['--', ...paths],
        'working-tree',
        remaining
      )
      sections.push(section)
    } else if (change.unstaged) {
      sections.push({ source: 'working-tree', patch: '', binary: false, truncated: true })
    }
  }

  return {
    path: change.path,
    ...(change.previousPath ? { previousPath: change.previousPath } : {}),
    sections
  }
}
