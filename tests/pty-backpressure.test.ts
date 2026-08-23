/**
 * Guard suite: the 4 MB backpressure cap (NFR-08 adjacent — a runaway process
 * must not grow main-process memory without bound).
 *
 * The arithmetic is tested against the real cap through the pure
 * `appendWithCap`, because pushing 4 MB through ConPTY is slow and flaky on
 * `windows-latest`. `tests/pty.test.ts` proves the wiring with real processes.
 */
import { describe, expect, it } from 'vitest'
import { TRUNCATION_MARKER, appendWithCap } from '../src/main/pty/PtyManager'

const CAP = 4 * 1024 * 1024

function totalBytes(pending: string[]): number {
  return pending.reduce((sum, chunk) => sum + chunk.length, 0)
}

describe('appendWithCap', () => {
  it('keeps everything while under the cap', () => {
    const pending: string[] = []
    let bytes = 0

    bytes = appendWithCap(pending, bytes, 'a'.repeat(1000), CAP)
    bytes = appendWithCap(pending, bytes, 'b'.repeat(1000), CAP)

    expect(pending.join('')).toBe(`${'a'.repeat(1000)}${'b'.repeat(1000)}`)
    expect(bytes).toBe(2000)
    expect(pending.join('')).not.toContain(TRUNCATION_MARKER)
  })

  it('drops the oldest chunks once the real 4 MB cap is exceeded', () => {
    const pending: string[] = []
    let bytes = 0
    const chunk = 'x'.repeat(64 * 1024)

    // 6 MB of output through the real cap.
    for (let i = 0; i < 96; i += 1) bytes = appendWithCap(pending, bytes, chunk, CAP)

    expect(bytes).toBeLessThanOrEqual(CAP)
    expect(totalBytes(pending)).toBeLessThanOrEqual(CAP + TRUNCATION_MARKER.length)
  })

  it('marks the truncation in-band exactly once', () => {
    const pending: string[] = []
    let bytes = 0
    const chunk = 'x'.repeat(1024 * 1024)

    for (let i = 0; i < 8; i += 1) bytes = appendWithCap(pending, bytes, chunk, CAP)

    const joined = pending.join('')
    expect(joined).toContain(TRUNCATION_MARKER)
    expect(joined.split(TRUNCATION_MARKER).length - 1).toBe(1)
    // The user sees the notice before the surviving output, not after it.
    expect(joined.startsWith(TRUNCATION_MARKER)).toBe(true)
  })

  it('never drops the only chunk, however large', () => {
    const pending: string[] = []
    const huge = 'y'.repeat(CAP * 2)

    const bytes = appendWithCap(pending, 0, huge, CAP)

    expect(pending).toHaveLength(1)
    expect(bytes).toBe(huge.length)
    expect(pending[0]).toBe(huge)
  })

  it('is still wired into the PTY output path', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(process.cwd(), 'src/main/pty/PtyManager.ts'), 'utf8')

    // Guards against the enqueue path being rewritten to bypass the cap.
    expect(source).toMatch(/appendWithCap\(entry\.pending, entry\.pendingBytes, chunk, MAX_PENDING_CHARS\)/)
  })
})
