import { describe, expect, it } from 'vitest'
import { vscodeUrlForFile } from '../src/main/shell/vscode'

describe('VS Code file URL', () => {
  it('encodes reserved filename characters without changing the protocol', () => {
    const url = vscodeUrlForFile('C:\\repo\\space # percent %.ts')
    expect(url).toBe('vscode://file/C:/repo/space%20%23%20percent%20%25.ts')
  })
})
