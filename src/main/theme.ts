/**
 * Theme source of truth (FR-24..FR-26).
 *
 * `nativeTheme.themeSource` drives both the app chrome and what the renderer
 * paints; in System mode `nativeTheme.updated` fires when Windows switches, and
 * we rebroadcast so the change is live without a restart.
 */
import { nativeTheme } from 'electron'
import type { ResolvedTheme, ThemePreference } from '@shared/types'

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  nativeTheme.themeSource = preference
  return resolvedTheme()
}

export function resolvedTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

export function onSystemThemeChanged(listener: (theme: ResolvedTheme) => void): () => void {
  const handler = (): void => listener(resolvedTheme())
  nativeTheme.on('updated', handler)
  return () => nativeTheme.off('updated', handler)
}
