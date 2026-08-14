import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src'),
      // Main-process modules import Electron for userData paths; tests run in
      // plain Node, so the few APIs they touch are stubbed.
      electron: resolve('tests/stubs/electron.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Diagnostic only: `npm run test:coverage`. Deliberately no thresholds and
    // not wired into CI — a number to chase produces low-value tests, and the
    // guard suites are what actually hold the contracts.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts']
    }
  }
})
