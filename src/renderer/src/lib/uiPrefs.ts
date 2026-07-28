/**
 * Chrome-only view preferences (sidebar width, sidebar visibility).
 *
 * These describe how the window is arranged, not what the app is configured to
 * run, so they stay in the renderer instead of round-tripping through the main
 * process settings file. A missing or corrupt value degrades to the default.
 */

export const SIDEBAR_DEFAULT_WIDTH = 264
export const SIDEBAR_MIN_WIDTH = 220
export const SIDEBAR_MAX_WIDTH = 480

const WIDTH_KEY = 'elena.sidebar.width'
const HIDDEN_KEY = 'elena.sidebar.hidden'

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export function loadSidebarWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_KEY)
    return raw === null ? SIDEBAR_DEFAULT_WIDTH : clampSidebarWidth(Number(raw))
  } catch {
    return SIDEBAR_DEFAULT_WIDTH
  }
}

export function saveSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(clampSidebarWidth(width)))
  } catch {
    /* a full or disabled storage must never break the layout */
  }
}

export function loadSidebarHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function saveSidebarHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0')
  } catch {
    /* see saveSidebarWidth */
  }
}
