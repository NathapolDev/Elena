import { defineConfig } from '@playwright/test'

/**
 * Electron automation is still experimental in Playwright, so E2E covers user
 * flows only. Layout, PTY lifecycle and persistence are proven by the Vitest
 * suites, which do not depend on this runner (risk mitigation in the plan).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // CI uploads test-results/ as `e2e-failure-context`. Without these the
  // artifact is nearly empty, so a red E2E step is undebuggable after the fact.
  // Video stays off: Electron capture is unreliable and inflates the artifact.
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  }
})
