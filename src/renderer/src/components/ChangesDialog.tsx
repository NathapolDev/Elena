import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowSquareOutIcon } from '@phosphor-icons/react/ArrowSquareOut'
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/ArrowsClockwise'
import { XIcon } from '@phosphor-icons/react/X'
import type {
  GitChangeEntry,
  GitChangesSnapshot,
  GitDiffSection,
  GitFileDiff,
  Workspace
} from '@shared/types'
import { buildSideBySideDiff, MAX_VISIBLE_DIFF_LINES, prepareDiffPreview } from '@shared/unifiedDiff'
import type { DiffCell, UnifiedDiffLine } from '@shared/unifiedDiff'
import { ApiError, call, describeError } from '../lib/api'
import { useStore } from '../state/store'

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string }

type Props = {
  workspace: Workspace
  onClose: () => void
}

const SOURCE_LABEL: Record<GitDiffSection['source'], string> = {
  staged: 'Staged',
  'working-tree': 'Working tree',
  untracked: 'Untracked'
}

function statusLabel(change: GitChangeEntry): string {
  const label = change.kind[0]?.toUpperCase() + change.kind.slice(1)
  const areas = [change.staged ? 'staged' : '', change.untracked ? 'untracked' : change.unstaged ? 'unstaged' : ''].filter(Boolean)
  return areas.length > 0 ? `${label} · ${areas.join(' + ')}` : label
}

type DiffView = 'unified' | 'split'

function SplitCell({ line, side }: { line?: DiffCell; side: 'left' | 'right' }): React.JSX.Element {
  return (
    <div className={`changes__split-cell changes__split-cell--${side} changes__line--${line?.kind ?? 'empty'}`}>
      <span className="changes__line-number" aria-hidden="true">{(side === 'left' ? line?.oldLine : line?.newLine) ?? ''}</span>
      <span className="changes__line-text">
        {line?.text || ' '}
        {line?.note ? <span className="changes__line-note">{line.note}</span> : null}
      </span>
    </div>
  )
}

function SplitPatch({ lines, label }: { lines: UnifiedDiffLine[]; label: string }): React.JSX.Element {
  const rows = useMemo(() => buildSideBySideDiff(lines), [lines])
  return (
    <div className="changes__split-patch" role="region" aria-label={`${label} side by side diff`}>
      <div className="changes__split-head"><span>Before</span><span>After</span></div>
      {rows.map((row, index) => row.kind === 'lines' ? (
        <div className="changes__split-row" key={index}>
          <SplitCell line={row.left} side="left" />
          <SplitCell line={row.right} side="right" />
        </div>
      ) : (
        <div className={`changes__split-meta changes__line--${row.kind}`} key={index}>{row.text || ' '}</div>
      ))}
    </div>
  )
}

function DiffSection({ section, view }: { section: GitDiffSection; view: DiffView }): React.JSX.Element {
  const preview = useMemo(() => prepareDiffPreview(section.patch), [section.patch])
  const lines = preview.lines

  return (
    <section className="changes__diff-section" aria-label={`${SOURCE_LABEL[section.source]} diff`}>
      <h3>{SOURCE_LABEL[section.source]}</h3>
      {preview.truncated ? (
        <p className="changes__banner" role="status">Showing the first {MAX_VISIBLE_DIFF_LINES.toLocaleString()} diff lines. Open the file in VS Code to inspect the rest.</p>
      ) : null}
      {section.truncated ? (
        <p className="changes__banner" role="status">
          Diff is larger than 2 MiB. Showing the first part only.
        </p>
      ) : null}
      {section.binary ? (
        <div className="changes__empty">Binary file changed. Preview is unavailable.</div>
      ) : lines.length > 0 && view === 'split' ? (
        <SplitPatch lines={lines} label={SOURCE_LABEL[section.source]} />
      ) : lines.length > 0 ? (
        <div className="changes__patch" role="region" aria-label={`${SOURCE_LABEL[section.source]} unified diff`}>
          {lines.map((line, index) => (
            <div className={`changes__line changes__line--${line.kind}`} key={`${index}-${line.text}`}>
              <span className="changes__line-number" aria-hidden="true">{line.oldLine ?? ''}</span>
              <span className="changes__line-number" aria-hidden="true">{line.newLine ?? ''}</span>
              <span className="changes__line-text">{line.text || ' '}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="changes__empty">No textual diff for this state.</div>
      )}
    </section>
  )
}

export function ChangesDialog({ workspace, onClose }: Props): React.JSX.Element {
  const pushError = useStore((state) => state.pushError)
  const [view, setView] = useState<DiffView>('unified')
  const [changes, setChanges] = useState<LoadState<GitChangesSnapshot | null>>({ status: 'loading' })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ path: string; state: LoadState<GitFileDiff> } | null>(null)
  const changesRequest = useRef(0)

  const loadChanges = useCallback(async (): Promise<void> => {
    const request = ++changesRequest.current
    try {
      const snapshot = await call('git:changes', { workspaceId: workspace.id })
      if (request !== changesRequest.current) return
      setDiff(null)
      setChanges({ status: 'ready', value: snapshot })
      setSelectedPath((current) => {
        if (current && snapshot?.files.some((file) => file.path === current)) return current
        return snapshot?.files[0]?.path ?? null
      })
    } catch (error) {
      if (request !== changesRequest.current) return
      setChanges({ status: 'error', message: describeError(error).body })
      setSelectedPath(null)
    }
  }, [workspace.id])

  const refresh = useCallback(async (): Promise<void> => {
    setChanges({ status: 'loading' })
    await loadChanges()
  }, [loadChanges])

  useEffect(() => {
    let disposed = false
    queueMicrotask(() => {
      if (!disposed) void loadChanges()
    })
    const onFocus = (): void => void refresh()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('keydown', onKey)
    return () => {
      disposed = true
      changesRequest.current += 1
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('keydown', onKey)
    }
  }, [loadChanges, onClose, refresh])

  useEffect(() => {
    if (!selectedPath || changes.status !== 'ready') return
    let active = true
    void call('git:diff', { workspaceId: workspace.id, path: selectedPath })
      .then((value) => {
        if (active) setDiff({ path: selectedPath, state: { status: 'ready', value } })
      })
      .catch((error: unknown) => {
        if (!active) return
        if (error instanceof ApiError && error.code === 'NOT_FOUND') {
          void refresh()
          return
        }
        setDiff({ path: selectedPath, state: { status: 'error', message: describeError(error).body } })
      })
    return () => {
      active = false
    }
  }, [changes, refresh, selectedPath, workspace.id])

  const snapshot = changes.status === 'ready' ? changes.value : null
  const selected = snapshot?.files.find((file) => file.path === selectedPath)
  const selectedDiff: LoadState<GitFileDiff> | null = selectedPath
    ? diff?.path === selectedPath
      ? diff.state
      : { status: 'loading' }
    : null

  const openInVsCode = async (change: GitChangeEntry): Promise<void> => {
    try {
      await call('file:open-in-vscode', { workspaceId: workspace.id, path: change.path })
    } catch (error) {
      pushError(error)
    }
  }

  return (
    <div className="dialog-backdrop changes-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="dialog changes"
        role="dialog"
        aria-modal="true"
        aria-labelledby="changes-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="changes__header">
          <div>
            <h2 className="dialog__title" id="changes-title">Changed files</h2>
            <p>{workspace.name}{snapshot ? ` · ${snapshot.repository.branch}` : ''}</p>
          </div>
          <div className="changes__header-actions">
            <div className="segmented changes__view-toggle" role="group" aria-label="Diff view">
              <button type="button" className="segmented__option" aria-pressed={view === 'unified'} onClick={() => setView('unified')}>Unified</button>
              <button type="button" className="segmented__option" aria-pressed={view === 'split'} onClick={() => setView('split')}>Side by side</button>
            </div>
            <button type="button" className="button" onClick={() => void refresh()} disabled={changes.status === 'loading'}>
              <ArrowsClockwiseIcon size={17} /> Refresh
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close changed files" autoFocus>
              <XIcon size={18} />
            </button>
          </div>
        </header>

        <div className="changes__body">
          <aside className="changes__files" aria-label="Changed files list">
            {changes.status === 'loading' ? <div className="changes__empty">Loading changes…</div> : null}
            {changes.status === 'error' ? (
              <div className="changes__empty" role="alert">Could not load changes. {changes.message}</div>
            ) : null}
            {changes.status === 'ready' && changes.value === null ? (
              <div className="changes__empty">This workspace is not inside a Git repository.</div>
            ) : null}
            {snapshot && snapshot.files.length === 0 ? (
              <div className="changes__empty">No uncommitted changes.</div>
            ) : null}
            {snapshot?.truncated ? (
              <p className="changes__banner" role="status">Showing the first 1,000 changed files.</p>
            ) : null}
            {snapshot && snapshot.files.length > 0 ? (
              <ul>
                {snapshot.files.map((change) => (
                  <li className={change.path === selectedPath ? 'changes__file--active' : ''} key={change.path}>
                    <button
                      type="button"
                      className="changes__file-select"
                      onClick={() => setSelectedPath(change.path)}
                      aria-current={change.path === selectedPath}
                    >
                      <span className="changes__file-path" title={change.path}>{change.path}</span>
                      {change.previousPath ? <span className="changes__file-previous">from {change.previousPath}</span> : null}
                      <span className={`changes__file-status changes__file-status--${change.kind}`}>
                        {statusLabel(change)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button changes__vscode"
                      onClick={() => void openInVsCode(change)}
                      disabled={!change.openable}
                      aria-label={`Open ${change.path} in VS Code`}
                      title={change.openable ? 'Open in VS Code' : 'This file no longer exists or cannot be opened'}
                    >
                      <ArrowSquareOutIcon size={17} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </aside>

          <main className="changes__preview">
            {!selected ? <div className="changes__empty">Select a changed file to view its diff.</div> : null}
            {selected && selectedDiff?.status === 'loading' ? <div className="changes__empty">Loading diff…</div> : null}
            {selected && selectedDiff?.status === 'error' ? (
              <div className="changes__empty" role="alert">Could not load diff. {selectedDiff.message}</div>
            ) : null}
            {selected && selectedDiff?.status === 'ready' ? (
              <>
                <header className="changes__preview-header">
                  <strong title={selectedDiff.value.path}>{selectedDiff.value.path}</strong>
                  {selectedDiff.value.previousPath ? <span>Renamed from {selectedDiff.value.previousPath}</span> : null}
                </header>
                <div className="changes__sections">
                  {selectedDiff.value.sections.map((section) => <DiffSection section={section} view={view} key={section.source} />)}
                </div>
              </>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  )
}
