/**
 * Minimal Electron stub so main-process modules can be unit tested in plain
 * Node. Only the surface the stores and logger touch is implemented.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const app = {
  isPackaged: true,
  getPath: (name: string): string => join(tmpdir(), 'elena-tests', name),
  getVersion: (): string => '0.3.0'
}

export const nativeTheme = {
  themeSource: 'system' as 'system' | 'light' | 'dark',
  shouldUseDarkColors: true,
  on: () => {},
  off: () => {}
}
