import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildChildEnv, isInside, resolveExecutable, validateDirectory } from '../src/main/security/paths'

const root = mkdtempSync(join(tmpdir(), 'elena-paths-'))
const outsideRoot = mkdtempSync(join(tmpdir(), 'elena-paths-outside-'))
const nested = join(root, 'nested')
const filePath = join(root, 'a-file.txt')

writeFileSync(filePath, 'x')
mkdirSync(nested)
mkdtempSync(join(root, 'child-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outsideRoot, { recursive: true, force: true })
})

describe('isInside', () => {
  it('accepts the root itself and its descendants', () => {
    expect(isInside(root, root)).toBe(true)
    expect(isInside(root, join(root, 'deep', 'deeper'))).toBe(true)
  })

  it('rejects traversal out of the root', () => {
    expect(isInside(root, join(root, '..'))).toBe(false)
    expect(isInside(root, join(root, '..', 'sibling'))).toBe(false)
  })

  it('rejects a sibling with the same prefix', () => {
    expect(isInside(join(root, 'app'), join(root, 'app-2'))).toBe(false)
  })
})

describe('validateDirectory', () => {
  it('resolves an existing directory', () => {
    const result = validateDirectory(root)
    expect(result.ok).toBe(true)
  })

  it('rejects a missing path', () => {
    const result = validateDirectory(join(root, 'does-not-exist'))
    expect(result).toEqual({ ok: false, reason: 'missing' })
  })

  it('rejects a file', () => {
    expect(validateDirectory(filePath)).toEqual({ ok: false, reason: 'not-a-directory' })
  })

  it('rejects a NUL byte before it reaches the OS', () => {
    expect(validateDirectory(`${root}\0evil`)).toEqual({ ok: false, reason: 'denied' })
  })

  it('enforces containment when a root is given', () => {
    expect(validateDirectory(outsideRoot, root)).toEqual({ ok: false, reason: 'outside-root' })
  })

  it('resolves a relative directory against the containment root', () => {
    const result = validateDirectory('nested', root)
    expect(result).toEqual({ ok: true, path: realPath(nested), isDirectory: true })
  })

  it('rejects a directory link that escapes the containment root', () => {
    const link = join(root, 'escape-link')
    symlinkSync(outsideRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(validateDirectory(link, root)).toEqual({ ok: false, reason: 'outside-root' })
  })
})

function realPath(path: string): string {
  const result = validateDirectory(path)
  return result.ok ? result.path : path
}

describe('resolveExecutable', () => {
  it('finds a real executable on PATH', () => {
    const expected = process.platform === 'win32' ? 'cmd' : 'sh'
    expect(resolveExecutable(expected)).toBeTruthy()
  })

  it('returns null for something not installed', () => {
    expect(resolveExecutable('definitely-not-a-real-binary-xyz')).toBeNull()
  })

  it('returns null for a NUL byte', () => {
    expect(resolveExecutable('cmd\0.exe')).toBeNull()
  })
})

describe('buildChildEnv', () => {
  const source = {
    PATH: '/usr/bin',
    SystemRoot: 'C:\\Windows',
    ANTHROPIC_API_KEY: 'secret-value',
    UNRELATED_TOKEN: 'nope'
  } as NodeJS.ProcessEnv

  it('passes through base variables the child needs', () => {
    const env = buildChildEnv([], source)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.SystemRoot).toBe('C:\\Windows')
  })

  it('only includes extra variables that are explicitly allowlisted', () => {
    const env = buildChildEnv(['ANTHROPIC_API_KEY'], source)
    expect(env.ANTHROPIC_API_KEY).toBe('secret-value')
    expect(env.UNRELATED_TOKEN).toBeUndefined()
  })

  it('always declares a colour-capable terminal', () => {
    const env = buildChildEnv([], source)
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
  })
})
