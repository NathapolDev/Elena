import { useEffect, useState } from 'react'
import { GitDiffIcon } from '@phosphor-icons/react/GitDiff'
import type { GitChangesSnapshot } from '@shared/types'
import { call } from '../lib/api'

type Props = { workspaceId?: string; dialogOpen: boolean; onClick: () => void }

export function ChangesButton({ workspaceId, dialogOpen, onClick }: Props): React.JSX.Element {
  const [result, setResult] = useState<{ workspaceId: string; summary: GitChangesSnapshot['summary'] } | null>(null)
  useEffect(() => {
    if (!workspaceId || dialogOpen) return
    let active = true
    let busy = false
    const refresh = async (): Promise<void> => {
      if (busy) return
      busy = true
      try {
        const snapshot = await call('git:changes', { workspaceId })
        if (active) setResult({ workspaceId, summary: snapshot?.summary })
      } catch {
        if (active) setResult(null)
      } finally {
        busy = false
      }
    }
    const onFocus = (): void => { void refresh() }
    void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      active = false
      window.removeEventListener('focus', onFocus)
    }
  }, [workspaceId, dialogOpen])
  const summary = result?.workspaceId === workspaceId ? result?.summary : undefined
  const title = summary
    ? `View changed files: ${summary.incomplete ? 'at least ' : ''}${summary.additions} added, ${summary.deletions} deleted lines (staged + unstaged + untracked)`
    : 'View changed files'
  return (
    <button type="button" className="button changes-trigger" onClick={onClick} disabled={!workspaceId} aria-label="View changed files" title={title}>
      <GitDiffIcon size={18} /> <span className="changes-trigger__label">Changes</span>
      {summary ? (
        <span className="changes-trigger__counts" aria-hidden="true">
          {summary.incomplete ? <span>≥</span> : null}
          <span className="changes-trigger__added">+{summary.additions.toLocaleString()}</span>
          <span className="changes-trigger__deleted">−{summary.deletions.toLocaleString()}</span>
        </span>
      ) : null}
    </button>
  )
}
