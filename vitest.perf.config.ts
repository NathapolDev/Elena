/**
 * P8: the perf smoke runs on its own config so it stays out of `npm test`.
 *
 * `tests/*.perf.ts` is a stopwatch, not a contract — a loaded machine should
 * not turn the guard suites red. Everything else (aliases, the Electron stub,
 * the node environment) is the main config, unchanged.
 */
import { defineConfig } from 'vitest/config'
import base from './vitest.config'

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/*.perf.ts'],
    testTimeout: 120_000
  }
})
