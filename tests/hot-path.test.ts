/**
 * Guard suite: the hot paths named in AGENTS.md > Multiplicative paths.
 *
 * These are crude source scans, deliberately. Each one pins a regression that
 * actually shipped and that no type or runtime check can catch — the code stays
 * correct while costing N times what it should, and the only symptom is a laggy
 * app on someone else's machine.
 *
 * A failure here means a hot path grew work, not that the test is stale. The
 * numbers live in `npm run test:perf`; these are the shapes.
 */
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8')
}

function sourcesUnder(dir: string, extensions: readonly string[]): { label: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourcesUnder(full, extensions)
    if (!extensions.some((extension) => entry.name.endsWith(extension))) return []
    return [{ label: relative(ROOT, full).replaceAll(String.fromCharCode(92), '/'), source: readFileSync(full, 'utf8') }]
  })
}

describe('terminal:data is sent to one window', () => {
  it('is never broadcast', () => {
    // x every trusted window, every 16 ms, per running session. The renderer
    // filter that used to follow it still paid for the structured clone.
    const offenders = sourcesUnder(join(ROOT, 'src/main'), ['.ts'])
      .filter(({ source }) => /broadcast\(\s*'terminal:data'/.test(source))
      .map(({ label }) => label)

    expect(offenders, "terminal:data must go through sendTo(webContentsForTerminal(id), …)").toEqual([])
  })
})

describe('the divider drag', () => {
  it('sends workspace:update through the frame scheduler, not directly', () => {
    // pointermove fires above the refresh rate on a high-polling mouse, and
    // every send makes every window refetch every workspace.
    const store = read('src/renderer/src/state/store.ts')
    const updateRatio = /updateRatio\(path, ratio\) \{[\s\S]*?\n {2}\},/.exec(store)?.[0] ?? ''

    expect(updateRatio, 'updateRatio not found — update this guard').not.toBe('')
    expect(updateRatio).toContain('scheduleLayoutSend(')
    expect(updateRatio, 'a direct call here is one IPC round trip per pointer event').not.toMatch(
      /call\(\s*'workspace:update'/
    )
  })
})

describe('the log write path', () => {
  it('does not stat the log file on every line', () => {
    // x every log call, on the thread that owns every PTY.
    const logger = read('src/main/logger.ts')
    const write = /function write\(level: Level[\s\S]*?\n\}/.exec(logger)?.[0] ?? ''

    expect(write, 'write() not found — update this guard').not.toBe('')
    expect(write).not.toMatch(/statSync|existsSync/)
  })
})

describe('the PTY flush', () => {
  it('bounds a single send', () => {
    // Hitting the 4 MB pending cap must not become one 4 MB structured clone.
    const pty = read('src/main/pty/PtyManager.ts')

    expect(pty).toMatch(/MAX_SEND_CHARS/)
    const flush = /private flush\(entry: Entry\): void \{[\s\S]*?\n {2}\}/.exec(pty)?.[0] ?? ''
    expect(flush, 'flush() not found — update this guard').not.toBe('')
    expect(flush).toContain('MAX_SEND_CHARS')
  })
})
