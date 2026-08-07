/**
 * How this process was distributed, and what that means for updating.
 *
 * Kept apart from `index.ts` so the rule stays a pure function: the tests can
 * cover every combination without stubbing `process.platform` or `app`.
 */
import { app } from 'electron'

export type Distribution = {
  packaged: boolean
  platform: NodeJS.Platform
  e2e: boolean
}

export function currentDistribution(): Distribution {
  return {
    packaged: app.isPackaged,
    platform: process.platform,
    e2e: process.env.ELENA_E2E === '1'
  }
}

/**
 * electron-updater reads the GitHub release channel, so it only makes sense in
 * a packaged Windows build. E2E runs are excluded so the suite never reaches
 * the network.
 */
export function updatesSupported(distribution: Distribution): boolean {
  return distribution.packaged && distribution.platform === 'win32' && !distribution.e2e
}
