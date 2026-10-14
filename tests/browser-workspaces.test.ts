import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../src/shared/types'
import { call } from '../src/renderer/src/lib/api'
import { useStore } from '../src/renderer/src/state/store'

vi.mock('../src/renderer/src/lib/api', () => ({ call: vi.fn(), describeError: (error: Error) => ({ title: 'Error', body: error.message }) }))
vi.mock('../src/renderer/src/lib/terminalRegistry', () => ({ acquireTerminal: vi.fn(), getTerminal: vi.fn(), releaseTerminal: vi.fn() }))

function project(id: string): Workspace {
  return { id, name: id, projectRoot: `D:\\${id}`, createdAt: '', updatedAt: '', activeTerminalId: `${id}-term`,
    layout: { type: 'terminal', terminalId: `${id}-term` },
    terminals: [{ id: `${id}-term`, title: id, executable: 'pwsh.exe', args: [], cwd: `D:\\${id}`, envAllowlist: [] }] }
}
const invoke = vi.mocked(call)
beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState(useStore.getInitialState(), true)
  useStore.setState({ ready: true, workspaces: [project('a'), project('b')], openWorkspaceIds: ['a', 'b'], activeWorkspaceId: 'a', activeTerminalId: 'a-term',
    sessions: { 'a-term': { terminalId: 'a-term', status: 'running', pid: 101 } } })
})

describe('saved projects and background sessions', () => {
  it('restores saved configurations even when an old layout has no selected leaf', async () => {
    const restored = { ...project('a'), layout: null, activeTerminalId: 'removed-terminal' }
    const settings = useStore.getInitialState().settings
    useStore.setState({ ready: false, activeWorkspaceId: null, activeTerminalId: null })
    invoke.mockImplementation((channel) => {
      if (channel === 'workspace:list') return Promise.resolve([restored])
      if (channel === 'settings:get') return Promise.resolve({ settings, resolvedTheme: 'dark' as const })
      if (channel === 'window:detached') return Promise.resolve({ terminalIds: [] })
      return Promise.resolve([])
    })
    await useStore.getState().bootstrap()
    expect(useStore.getState().activeTerminalId).toBe('a-term')
    expect(useStore.getState().sessions).toEqual({})
    expect(useStore.getState().workspaces[0]?.layout).toBeNull()
    expect(invoke.mock.calls.some(([channel]) => channel === 'terminal:create')).toBe(false)
  })
  it('closing a group never terminates its process or changes its configuration', () => {
    useStore.getState().closeProject('a')
    expect(call).not.toHaveBeenCalled()
    expect(useStore.getState().activeWorkspaceId).toBe('b')
    expect(useStore.getState().workspaces[0]).toEqual(project('a'))
    expect(useStore.getState().sessions['a-term']?.pid).toBe(101)
    useStore.getState().closeProject('b')
    expect(useStore.getState().activeTerminalId).toBeNull()
    useStore.getState().markUnread('a-term')
    expect(useStore.getState().unread['a-term']).toBe(true)
  })
  it('reopening a bookmark reuses the workspace and live session without a spawn', async () => {
    invoke.mockResolvedValue({ path: 'D:\\a', isDirectory: true })
    useStore.getState().closeProject('a')
    await useStore.getState().openWorkspaceById('a')
    await useStore.getState().openWorkspaceById('a')
    expect(useStore.getState().openWorkspaceIds).toEqual(['b', 'a'])
    expect(useStore.getState().sessions['a-term']?.pid).toBe(101)
    expect(useStore.getState().workspaces).toHaveLength(2)
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual(['path:validate', 'path:validate'])
  })
  it('a missing saved path remains saved and does not open a folder picker', async () => {
    invoke.mockRejectedValue(new Error('Folder missing'))
    useStore.getState().closeProject('a')
    await useStore.getState().openWorkspaceById('a')
    expect(useStore.getState().activeWorkspaceId).toBe('b')
    expect(useStore.getState().workspaces).toHaveLength(2)
    expect(useStore.getState().toasts[0]?.body).toBe('Folder missing')
    expect(call).toHaveBeenCalledExactlyOnceWith('path:validate', { path: 'D:\\a' })
  })
  it('collapsing a group does not change focus, layout or the process', () => {
    useStore.getState().toggleProjectCollapsed('a')
    expect(useStore.getState().activeTerminalId).toBe('a-term')
    expect(useStore.getState().workspaces[0]?.layout).toEqual(project('a').layout)
    expect(call).not.toHaveBeenCalled()
  })
  it('does not notify store subscribers for repeated background output', () => {
    useStore.getState().closeProject('a')
    const listener = vi.fn()
    const off = useStore.subscribe(listener)
    for (let i = 0; i < 100; i += 1) useStore.getState().markUnread('a-term')
    expect(listener).toHaveBeenCalledTimes(1)
    off()
  })
  it('creation keeps its original project across asynchronous validation', async () => {
    let finishValidation!: (value: { path: string; isDirectory: boolean }) => void
    invoke.mockImplementation((channel, payload = undefined) => {
      if (channel === 'path:validate') return new Promise<{ path: string; isDirectory: boolean }>((resolve) => { finishValidation = resolve })
      if (channel === 'workspace:update') {
        const request = payload as { id: string; patch: Partial<Workspace> }
        return Promise.resolve({ ...project(request.id), ...request.patch })
      }
      if (channel === 'terminal:create') return Promise.resolve({ terminalId: (payload as { terminalId: string }).terminalId, status: 'running' as const, pid: 202 })
      return Promise.resolve(null)
    })
    const pending = useStore.getState().addTerminal({ workspaceId: 'a', title: 'New', executable: 'pwsh.exe', args: [], cwd: 'D:\\a', envAllowlist: [] })
    useStore.getState().selectWorkspace('b')
    finishValidation({ path: 'D:\\a', isDirectory: true })
    await pending
    expect(useStore.getState().activeWorkspaceId).toBe('b')
    expect(useStore.getState().activeTerminalId).toBe('b-term')
    expect(useStore.getState().workspaces[0]?.terminals).toHaveLength(2)
    expect(useStore.getState().workspaces[1]?.terminals).toHaveLength(1)
    expect(call).toHaveBeenCalledWith('terminal:create', expect.objectContaining({ workspaceId: 'a' }))
  })
  it('closing a tab after navigation updates its owner without moving current focus', async () => {
    let terminated!: () => void
    invoke.mockImplementation((channel, payload = undefined) => {
      if (channel === 'terminal:terminate') return new Promise<null>((resolve) => { terminated = () => resolve(null) })
      if (channel === 'workspace:update') {
        const request = payload as { id: string; patch: Partial<Workspace> }
        return Promise.resolve({ ...project(request.id), ...request.patch })
      }
      return Promise.resolve(null)
    })
    const closing = useStore.getState().closeTerminal('a-term')
    useStore.getState().selectWorkspace('b')
    terminated()
    await closing
    expect(useStore.getState().activeTerminalId).toBe('b-term')
    expect(useStore.getState().workspaces[0]?.terminals).toHaveLength(0)
    expect(call).toHaveBeenCalledWith('workspace:update', expect.objectContaining({ id: 'a', patch: expect.objectContaining({ activeTerminalId: null }) }))
  })
})
