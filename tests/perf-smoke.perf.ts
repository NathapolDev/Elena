/**
 * Perf smoke: the RELEASE.md criterion as a measurement instead of a checkbox.
 *
 * "10 PTYs producing heavy output must not stall the event loop past 200 ms,
 * and must leave no process behind" was a manual tick, which is another way of
 * saying it was never checked. This drives the real PtyManager — the batching,
 * the backpressure cap and the per-send cap are all in the path — and measures
 * what the main process would actually feel.
 *
 * Excluded from `npm test` (see vitest.config.ts) because it is a stopwatch, not
 * a contract: run it with `npm run test:perf`. CI runs it before `build:win`.
 * A number that moved is a regression to investigate, not a flaky test to
 * silence — record the baseline before blaming the machine.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { afterAll, describe, expect, it } from 'vitest'
import { PtyManager } from '../src/main/pty/PtyManager'
import type { TerminalConfig } from '@shared/types'

const TERMINALS = 10
const MAX_LAG_MS = 200
const RUN_MS = 8_000
const sep = String.fromCharCode(10)

const dir = mkdtempSync(join(tmpdir(), 'elena-perf-'))
afterAll(() => {
  // The shells are killed, but Windows can hold their cwd open a moment longer.
  // A temp folder left behind is not a failed measurement.
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

const isWindows = process.platform === 'win32'

/** A shell that prints without pause, so the flush path is the bottleneck. */
function noisyCommand(): { executable: string; args: string[] } {
  return isWindows
    ? { executable: 'cmd.exe', args: ['/c', 'for /L %i in (1,1,200000) do @echo elena perf smoke line %i'] }
    : { executable: 'sh', args: ['-c', 'i=0; while [ $i -lt 200000 ]; do echo "elena perf smoke line $i"; i=$((i+1)); done'] }
}

function config(id: string): TerminalConfig {
  return { id, title: id, ...noisyCommand(), cwd: dir, envAllowlist: [] }
}

describe('perf smoke', () => {
  it(`keeps the event loop under ${MAX_LAG_MS} ms with ${TERMINALS} noisy PTYs`, async () => {
    let chunks = 0
    let chars = 0
    let largestSend = 0

    const manager = new PtyManager({
      onData: (_id, chunk) => {
        chunks += 1
        chars += chunk.length
        if (chunk.length > largestSend) largestSend = chunk.length
      },
      onStatus: () => {},
      onExit: () => {}
    })

    const histogram = monitorEventLoopDelay({ resolution: 10 })
    const rssBefore = process.memoryUsage().rss

    for (let i = 0; i < TERMINALS; i++) {
      const created = manager.create(config(`perf-${i}`), 120, 40, dir)
      expect(created.ok, `terminal ${i} failed to start`).toBe(true)
    }

    histogram.enable()
    await new Promise((resolve) => setTimeout(resolve, RUN_MS))
    histogram.disable()

    const rssGrowthMb = (process.memoryUsage().rss - rssBefore) / 1024 / 1024
    const maxLagMs = histogram.max / 1e6
    const p99LagMs = histogram.percentile(99) / 1e6

    manager.disposeAll()
    expect(manager.runningCount()).toBe(0)

    // process.stdout.write, not console.log: the reporter intercepts console
    // output and the numbers are the entire point of this test.
    process.stdout.write(
      [
        `terminals        ${TERMINALS}`,
        `window           ${RUN_MS} ms`,
        `output           ${(chars / 1024 / 1024).toFixed(1)} MB in ${chunks} sends`,
        `largest send     ${(largestSend / 1024).toFixed(0)} KB`,
        `event-loop p99   ${p99LagMs.toFixed(1)} ms`,
        `event-loop max   ${maxLagMs.toFixed(1)} ms`,
        `rss growth       ${rssGrowthMb.toFixed(1)} MB`
      ].join(sep) + sep
    )

    // Proves the run was real: a shell that failed to start measures a quiet
    // event loop and passes every threshold below.
    expect(chars).toBeGreaterThan(1024 * 1024)
    expect(maxLagMs).toBeLessThan(MAX_LAG_MS)
    // P6: the per-send cap is what keeps one burst from becoming one huge
    // structured clone. 2x the cap allows for a single oversized PTY chunk.
    expect(largestSend).toBeLessThan(512 * 1024)
  }, 60_000)
})
