import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Windows update release configuration', () => {
  it('pins the updater and publishes the stable GitHub channel', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      version: string
      dependencies: Record<string, string>
    }
    const builder = readFileSync('electron-builder.yml', 'utf8')

    expect(pkg.version).toBe('0.4.0')
    expect(pkg.dependencies['electron-updater']).toBe('6.8.9')
    expect(builder).toContain('provider: github')
    expect(builder).toContain('owner: NathapolDev')
    expect(builder).toContain('repo: Elena')
    expect(builder).toContain('channel: latest')
    expect(builder).toContain('releaseType: release')
  })

  it('uploads every artifact needed by electron-updater', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(workflow.match(/release\/\*\.exe$/gm)).toHaveLength(2)
    expect(workflow.match(/release\/\*\.exe\.blockmap$/gm)).toHaveLength(2)
    expect(workflow.match(/release\/latest\.yml$/gm)).toHaveLength(2)
  })
})
