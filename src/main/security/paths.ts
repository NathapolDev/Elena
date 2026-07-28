/**
 * Path validation. Runs in the main process before any spawn or filesystem
 * write (NFR-13). Pure functions live here so they are unit testable without
 * Electron.
 */
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, normalize, relative, resolve, sep } from 'node:path'

export type PathCheck =
  | { ok: true; path: string; isDirectory: boolean }
  | { ok: false; reason: 'not-absolute' | 'missing' | 'not-a-directory' | 'outside-root' | 'denied' }

/** True when `child` is `parent` or lives underneath it. Case-insensitive on win32. */
export function isInside(parent: string, child: string): boolean {
  const p = normalize(resolve(parent))
  const c = normalize(resolve(child))
  const a = process.platform === 'win32' ? p.toLowerCase() : p
  const b = process.platform === 'win32' ? c.toLowerCase() : c
  if (a === b) return true
  const rel = relative(a, b)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

export function validateDirectory(input: string, mustBeInside?: string): PathCheck {
  if (typeof input !== 'string' || input.trim().length === 0) return { ok: false, reason: 'missing' }
  // Reject anything with a NUL byte before it reaches the OS layer.
  if (input.includes('\0')) return { ok: false, reason: 'denied' }

  if (!isAbsolute(input) && !mustBeInside) return { ok: false, reason: 'not-absolute' }
  const target = isAbsolute(input) ? resolve(input) : resolve(mustBeInside!, input)

  let stats
  try {
    stats = statSync(target)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  if (!stats.isDirectory()) return { ok: false, reason: 'not-a-directory' }
  try {
    accessSync(target, constants.R_OK)
  } catch {
    return { ok: false, reason: 'denied' }
  }

  let canonicalTarget: string
  try {
    canonicalTarget = realpathSync.native(target)
  } catch {
    return { ok: false, reason: 'denied' }
  }
  if (mustBeInside) {
    let canonicalRoot: string
    try {
      canonicalRoot = realpathSync.native(resolve(mustBeInside))
    } catch {
      return { ok: false, reason: 'missing' }
    }
    if (!isInside(canonicalRoot, canonicalTarget)) return { ok: false, reason: 'outside-root' }
  }
  return { ok: true, path: canonicalTarget, isDirectory: true }
}

/**
 * Resolves an executable the way a shell would, without going through a shell
 * (NFR-12). Returns null when it cannot be found so the caller can raise
 * EXECUTABLE_NOT_FOUND instead of letting spawn fail opaquely.
 */
export function resolveExecutable(
  executable: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!executable || executable.includes('\0')) return null

  const isExecutableFile = (candidate: string): boolean => {
    try {
      return statSync(candidate).isFile()
    } catch {
      return false
    }
  }

  const extensions =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : ['']

  const withExtensions = (base: string): string[] => {
    const hasKnownExt = extensions.some((ext) => base.toLowerCase().endsWith(ext.toLowerCase()))
    return hasKnownExt || process.platform !== 'win32'
      ? [base]
      : [base, ...extensions.map((ext) => base + ext)]
  }

  if (executable.includes(sep) || executable.includes('/') || isAbsolute(executable)) {
    for (const candidate of withExtensions(resolve(executable))) {
      if (isExecutableFile(candidate)) return candidate
    }
    return null
  }

  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const candidate of withExtensions(resolve(dir.replace(/^"|"$/g, ''), executable))) {
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

/**
 * Variables every Windows process needs to function. Preset allowlists are
 * additive on top of this; values are read from the live OS environment and
 * never persisted (FR-18).
 */
const BASE_ENV_KEYS = [
  'SystemRoot',
  'SystemDrive',
  'windir',
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'PROGRAMW6432',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'LANG',
  'SHELL',
  'TERM'
]

export function buildChildEnv(
  allowlist: readonly string[],
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const wanted = new Set<string>([...BASE_ENV_KEYS, ...allowlist])
  const lookup = new Map<string, string>()
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) lookup.set(key.toLowerCase(), value)
  }

  const env: Record<string, string> = {}
  for (const key of wanted) {
    const value = lookup.get(key.toLowerCase())
    if (value !== undefined) env[key] = value
  }
  env.TERM = env.TERM ?? 'xterm-256color'
  env.COLORTERM = 'truecolor'
  return env
}
