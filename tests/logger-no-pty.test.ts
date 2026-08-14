/**
 * Guard suite: NFR-09 — terminal I/O, keystrokes and env values are never
 * logged.
 *
 * `sanitize()` in the logger is shape-based (it redacts token-looking strings
 * and sensitive-looking keys), which is correct for what it does but cannot
 * recognise a PTY chunk: a chunk logged as a value is merely newline-flattened
 * and cut to 500 characters, and the first 500 characters of terminal output
 * then land in app.log. `register.ts` documents the discipline in a comment;
 * this suite is the mechanism.
 *
 * A failure here means a log call gained a field that can carry terminal output
 * or environment values. Remove the field — do not widen the list below.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_MAIN = join(process.cwd(), 'src/main')

/** Field names that carry PTY output, user input, or raw environment values. */
const FORBIDDEN_FIELDS = [
  'data',
  'chunk',
  'chunks',
  'output',
  'buffer',
  'pending',
  'stdout',
  'stderr',
  'keystrokes',
  'input',
  'env',
  'value',
  'values'
]

function collect(dir: string): { label: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collect(full)
    if (!entry.name.endsWith('.ts')) return []
    return [{ label: relative(process.cwd(), full).replaceAll('\\', '/'), source: readFileSync(full, 'utf8') }]
  })
}

/** Extracts the `{ … }` metadata argument of each logger call, if present. */
function loggerMetadata(source: string): { line: number; body: string }[] {
  const found: { line: number; body: string }[] = []
  for (const match of source.matchAll(/logger\.(?:debug|info|warn|error)\(\s*'[^']*'\s*,\s*\{/g)) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let end = open
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    found.push({
      line: source.slice(0, match.index).split('\n').length,
      body: source.slice(open + 1, end)
    })
  }
  return found
}

const files = collect(SRC_MAIN)

describe('logger call sites', () => {
  it('finds the log calls it is meant to police', () => {
    // Guards against the extractor silently matching nothing after a refactor.
    const total = files.reduce((sum, file) => sum + loggerMetadata(file.source).length, 0)
    expect(total).toBeGreaterThan(3)
  })

  it('never logs a field that can carry terminal output or env values', () => {
    const offenders: string[] = []

    for (const { label, source } of files) {
      for (const { line, body } of loggerMetadata(source)) {
        const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        // Top-level keys only: `{ data }`, `{ data: x }`, `{ chunk, id }`.
        const keys = [...withoutComments.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?::|,|$)/g)]
          .map(([, key]) => key)
          .filter((key): key is string => Boolean(key))
        for (const key of keys) {
          if (FORBIDDEN_FIELDS.includes(key)) offenders.push(`${label}:${line} logs \`${key}\``)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('never passes a PTY chunk positionally', () => {
    const offenders = files
      .filter(({ source }) => /logger\.(?:debug|info|warn|error)\(\s*(?:chunk|data|payload)\b/.test(source))
      .map(({ label }) => label)

    expect(offenders).toEqual([])
  })
})

describe('renderer console mirroring', () => {
  it('stays out of the log file', () => {
    // index.ts mirrors renderer console messages to the dev terminal only.
    const index = readFileSync(join(SRC_MAIN, 'index.ts'), 'utf8')
    const consoleMessage = index.slice(index.indexOf("'console-message'"))
    expect(consoleMessage.slice(0, 300)).not.toContain('logger.')
  })
})
