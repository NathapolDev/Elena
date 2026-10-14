import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadBrowserPrefs, reconcileBrowserPrefs, saveBrowserPrefs } from '../src/renderer/src/lib/uiPrefs'

afterEach(() => vi.unstubAllGlobals())

describe('browser chrome preferences', () => {
  it('opens only the first saved project on upgrade, without losing the others', () => {
    expect(reconcileBrowserPrefs(null, ['first', 'second'])).toEqual({
      openWorkspaceIds: ['first'], collapsedWorkspaceIds: [], activeWorkspaceId: 'first'
    })
  })
  it('preserves deliberately closed groups across relaunch and removes stale IDs', () => {
    expect(reconcileBrowserPrefs({ openWorkspaceIds: [], collapsedWorkspaceIds: ['deleted'], activeWorkspaceId: 'deleted' }, ['saved'])).toEqual({
      openWorkspaceIds: [], collapsedWorkspaceIds: [], activeWorkspaceId: null
    })
    expect(reconcileBrowserPrefs({ openWorkspaceIds: ['deleted', 'valid', 'valid'], collapsedWorkspaceIds: ['valid', 'deleted'], activeWorkspaceId: 'deleted' }, ['valid'])).toEqual({
      openWorkspaceIds: ['valid'], collapsedWorkspaceIds: ['valid'], activeWorkspaceId: 'valid'
    })
  })
  it('honors an Explorer request even when the requested project was closed or collapsed', () => {
    expect(reconcileBrowserPrefs({ openWorkspaceIds: ['a'], collapsedWorkspaceIds: ['a', 'b'], activeWorkspaceId: 'a' }, ['a', 'b'], 'b')).toEqual({
      openWorkspaceIds: ['a', 'b'], collapsedWorkspaceIds: ['a'], activeWorkspaceId: 'b'
    })
  })
  it('validates stored chrome and degrades safely if storage is unavailable', () => {
    const getItem = vi.fn(() => '{broken')
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { getItem, setItem } })
    expect(loadBrowserPrefs()).toBeNull()
    getItem.mockReturnValue(JSON.stringify({ openWorkspaceIds: [3], collapsedWorkspaceIds: [], activeWorkspaceId: null }))
    expect(loadBrowserPrefs()).toBeNull()
    const prefs = { openWorkspaceIds: ['a'], collapsedWorkspaceIds: [], activeWorkspaceId: 'a' }
    getItem.mockReturnValue(JSON.stringify(prefs))
    expect(loadBrowserPrefs()).toEqual(prefs)
    saveBrowserPrefs(prefs)
    expect(setItem).toHaveBeenCalledWith('elena.browser.v1', JSON.stringify(prefs))
    setItem.mockImplementation(() => { throw new Error('Full storage') })
    expect(() => saveBrowserPrefs(prefs)).not.toThrow()
  })
})
