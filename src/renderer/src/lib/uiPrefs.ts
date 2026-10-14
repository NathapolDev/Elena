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

/** Window chrome only; saved projects remain authoritative in workspaces.json. */
export type BrowserPrefs = {
  openWorkspaceIds: string[]
  collapsedWorkspaceIds: string[]
  activeWorkspaceId: string | null
}

const BROWSER_KEY = 'elena.browser.v1'

export function loadBrowserPrefs(): BrowserPrefs | null {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(BROWSER_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    const isIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.every((id) => typeof id === 'string')
    if (!isIds(value.openWorkspaceIds) || !isIds(value.collapsedWorkspaceIds)) return null
    if (value.activeWorkspaceId !== null && typeof value.activeWorkspaceId !== 'string') return null
    return {
      openWorkspaceIds: [...new Set(value.openWorkspaceIds)],
      collapsedWorkspaceIds: [...new Set(value.collapsedWorkspaceIds)],
      activeWorkspaceId: value.activeWorkspaceId
    }
  } catch {
    return null
  }
}

export function reconcileBrowserPrefs(
  prefs: BrowserPrefs | null,
  workspaceIds: string[],
  preferredWorkspaceId?: string
): BrowserPrefs {
  const valid = new Set(workspaceIds)
  const openWorkspaceIds = prefs
    ? [...new Set(prefs.openWorkspaceIds)].filter((id) => valid.has(id))
    : workspaceIds.slice(0, 1)
  const preferred = preferredWorkspaceId && valid.has(preferredWorkspaceId) ? preferredWorkspaceId : null
  if (preferred && !openWorkspaceIds.includes(preferred)) openWorkspaceIds.push(preferred)
  const activeWorkspaceId = preferred ?? (prefs?.activeWorkspaceId && openWorkspaceIds.includes(prefs.activeWorkspaceId)
    ? prefs.activeWorkspaceId : openWorkspaceIds[0] ?? null)
  return {
    openWorkspaceIds,
    collapsedWorkspaceIds: (prefs?.collapsedWorkspaceIds ?? []).filter((id) => openWorkspaceIds.includes(id) && id !== preferred),
    activeWorkspaceId
  }
}

export function saveBrowserPrefs(prefs: BrowserPrefs): void {
  try {
    window.localStorage.setItem(BROWSER_KEY, JSON.stringify(prefs))
  } catch {
    /* Chrome persistence must never prevent a project from opening. */
  }
}
