import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      // Main-process modules import Electron for userData paths; tests run in
      // plain Node, so the few APIs they touch are stubbed.
      electron: resolve('tests/stubs/electron.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000
  }
})
