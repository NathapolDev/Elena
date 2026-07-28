/**
 * The git branch shown in each pane header.
 *
 * A branch changes because the user typed `git checkout` *inside* a pane, so
 * there is nothing to subscribe to — it is polled. Two things keep that cheap:
 * panes sharing a cwd (the common case: several agents on one project) share a
 * single watcher and a single IPC call, and polling stops while the window is
 * hidden and resumes with an immediate refresh on focus.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { call } from './api'
import type { GitBranchInfo } from '@shared/types'

const POLL_INTERVAL_MS = 5000

type Watcher = {
  /** `undefined` until the first read resolves, so the header can stay blank. */
  snapshot: GitBranchInfo | null | undefined
  listeners: Set<() => void>
  inFlight: boolean
}

const watchers = new Map<string, Watcher>()
/** One timer for every watcher — a pane count must not become a timer count. */
let pollTimer: ReturnType<typeof setInterval> | null = null

function sameInfo(a: GitBranchInfo | null | undefined, b: GitBranchInfo | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.branch === b.branch && a.root === b.root && a.detached === b.detached
}

async function refresh(cwd: string, watcher: Watcher): Promise<void> {
  // A slow disk must not queue up reads behind each other.
  if (watcher.inFlight) return
  watcher.inFlight = true
  try {
    const info = await call('git:branch', { path: cwd })
    if (sameInfo(watcher.snapshot, info)) return
    watcher.snapshot = info
    for (const listener of watcher.listeners) listener()
  } catch {
    // A deleted or unreadable folder is not worth a toast; keep the last value.
  } finally {
    watcher.inFlight = false
  }
}

function tick(): void {
  if (document.hidden) return
  for (const [cwd, watcher] of watchers) void refresh(cwd, watcher)
}

function refreshAll(): void {
  for (const [cwd, watcher] of watchers) void refresh(cwd, watcher)
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshAll()
})
window.addEventListener('focus', refreshAll)

function subscribe(cwd: string, listener: () => void): () => void {
  let watcher = watchers.get(cwd)
  if (!watcher) {
    watcher = { snapshot: undefined, listeners: new Set(), inFlight: false }
    watchers.set(cwd, watcher)
    void refresh(cwd, watcher)
  }
  watcher.listeners.add(listener)
  pollTimer ??= setInterval(tick, POLL_INTERVAL_MS)

  return () => {
    const current = watchers.get(cwd)
    if (!current) return
    current.listeners.delete(listener)
    if (current.listeners.size > 0) return
    // Dropped whole so a folder that stopped being a repo is not remembered.
    watchers.delete(cwd)
    if (watchers.size === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}

/** `undefined` while unknown, `null` when the folder is not in a git repo. */
export function useGitBranch(cwd: string): GitBranchInfo | null | undefined {
  // Stable per cwd: an inline subscriber would tear the watcher down and
  // re-read on every render of the pane.
  const subscribeToCwd = useCallback((listener: () => void) => subscribe(cwd, listener), [cwd])
  const getSnapshot = useCallback(() => watchers.get(cwd)?.snapshot, [cwd])
  return useSyncExternalStore(subscribeToCwd, getSnapshot)
}
