/**
 * App Execution Aliases (how the Microsoft Store and winget expose executables
 * such as pwsh) are reparse points that `statSync` refuses to read with EACCES,
 * even though spawning them works. `resolveExecutable` must treat that as a hit
 * so a Store-installed shell or agent CLI is discoverable.
 *
 * Lives in its own file because it mocks `node:fs`, which is hoisted per file
 * and would otherwise reach the real-filesystem checks in `paths.test.ts`.
 */
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'

const PATH_DIR = process.platform === 'win32' ? 'C:\\aliases' : '/aliases'
const ALIAS = resolve(PATH_DIR, 'aliased-tool.exe')
const ABSENT = resolve(PATH_DIR, 'not-installed.exe')

function fsError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>()
  return {
    ...actual,
    statSync: (path: Parameters<typeof actual.statSync>[0], ...rest: unknown[]) => {
      const target = resolve(String(path))
      if (target === ALIAS) throw fsError('EACCES')
      if (target === ABSENT) throw fsError('ENOENT')
      return (actual.statSync as (...args: unknown[]) => unknown)(path, ...rest)
    }
  }
})

const { resolveExecutable } = await import('../src/main/security/paths')

describe('resolveExecutable with an App Execution Alias on PATH', () => {
  const env = { PATH: PATH_DIR, PATHEXT: '.EXE' } as NodeJS.ProcessEnv

  it('accepts a candidate whose stat is denied rather than absent', () => {
    expect(resolveExecutable('aliased-tool.exe', env)).toBe(ALIAS)
  })

  it('still reports a genuinely missing executable as not found', () => {
    expect(resolveExecutable('not-installed.exe', env)).toBeNull()
  })
})
