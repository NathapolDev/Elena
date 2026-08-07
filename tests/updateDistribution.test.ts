import { describe, expect, it } from 'vitest'
import type { Distribution } from '../src/main/update/distribution'
import { currentDistribution, updatesSupported } from '../src/main/update/distribution'

function distribution(overrides: Partial<Distribution> = {}): Distribution {
  return { packaged: true, platform: 'win32', e2e: false, ...overrides }
}

describe('update distribution', () => {
  it('supports updates in a packaged Windows build', () => {
    expect(updatesSupported(distribution())).toBe(true)
  })

  it.each([
    ['unpackaged dev run', distribution({ packaged: false })],
    ['e2e run', distribution({ e2e: true })],
    ['non-Windows platform', distribution({ platform: 'darwin' })]
  ])('disables updates: %s', (_label, dist) => {
    expect(updatesSupported(dist)).toBe(false)
  })

  it('reads the live process', () => {
    const live = currentDistribution()
    expect(live.platform).toBe(process.platform)
    expect(typeof live.packaged).toBe('boolean')
    expect(typeof live.e2e).toBe('boolean')
  })
})
