import type { RuntimeSession } from '@shared/types'

export function relativeWorkspacePath(projectRoot: string, cwd: string): string {
  const normalizedRoot = projectRoot.replace(/[\\/]+$/, '')
  if (!cwd.toLocaleLowerCase().startsWith(normalizedRoot.toLocaleLowerCase())) return cwd
  const relative = cwd.slice(normalizedRoot.length).replace(/^[\\/]+/, '')
  return relative || '.'
}

export function formatSessionElapsed(session?: RuntimeSession, now = Date.now()): string {
  if (!session?.startedAt) return 'Not started'
  const end = session.endedAt ? Date.parse(session.endedAt) : now
  const start = Date.parse(session.startedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
