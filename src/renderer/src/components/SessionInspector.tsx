import { useMemo, useState } from 'react'
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/ArrowCounterClockwise'
import { CaretDoubleRightIcon } from '@phosphor-icons/react/CaretDoubleRight'
import { PlayIcon } from '@phosphor-icons/react/Play'
import { StopIcon } from '@phosphor-icons/react/Stop'
import { XIcon } from '@phosphor-icons/react/X'
import { acquireTerminal } from '../lib/terminalRegistry'
import { formatSessionElapsed, relativeWorkspacePath } from '../lib/sessionPresentation'
import { useStore } from '../state/store'
import { ConfirmDialog } from './ConfirmDialog'
import { StatusBadge } from './StatusBadge'
import type { TerminalConfig, Workspace } from '@shared/types'

type Props = {
  workspace: Workspace
  config: TerminalConfig
  onClose: () => void
}

export function SessionInspector({ workspace, config, onClose }: Props): React.JSX.Element {
  const session = useStore((state) => state.sessions[config.id])
  const presets = useStore((state) => state.presets)
  const scrollback = useStore((state) => state.settings.scrollback)
  const confirmCloseRunning = useStore((state) => state.settings.confirmCloseRunning)
  const restartTerminal = useStore((state) => state.restartTerminal)
  const stopTerminal = useStore((state) => state.stopTerminal)
  const closeTerminal = useStore((state) => state.closeTerminal)
  const [confirmClose, setConfirmClose] = useState(false)

  const presetName = useMemo(
    () => presets.find((preset) => preset.id === config.presetId)?.name ?? 'Custom session',
    [config.presetId, presets]
  )
  const isRunning = session?.status === 'running' || session?.status === 'starting'

  const restart = (): void => {
    const terminal = acquireTerminal(config.id, { scrollback, onOutput: () => {} })
    terminal.term.clear()
    void restartTerminal(config.id, terminal.term.cols, terminal.term.rows)
  }

  const requestClose = (): void => {
    if (isRunning && confirmCloseRunning) {
      setConfirmClose(true)
      return
    }
    void closeTerminal(config.id)
  }

  return (
    <aside className="inspector" aria-label="Session inspector">
      <header className="inspector__header">
        <span>Session inspector</span>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Hide session inspector">
          <CaretDoubleRightIcon size={18} />
        </button>
      </header>

      <div className="inspector__identity">
        <h2>{config.title}</h2>
        <StatusBadge {...(session ? { session } : {})} />
      </div>

      <dl className="inspector__details">
        <div>
          <dt>Preset</dt>
          <dd>{presetName}</dd>
        </div>
        <div>
          <dt>PID</dt>
          <dd>{session?.pid ?? '—'}</dd>
        </div>
        <div>
          <dt>cwd (relative)</dt>
          <dd title={config.cwd}>{relativeWorkspacePath(workspace.projectRoot, config.cwd)}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{formatSessionElapsed(session)}</dd>
        </div>
        <div>
          <dt>Exit code</dt>
          <dd>{session?.exitCode ?? '—'}</dd>
        </div>
      </dl>

      <div className="inspector__actions">
        <button type="button" className="button button--primary" onClick={restart}>
          {session ? <ArrowCounterClockwiseIcon size={18} /> : <PlayIcon size={18} />}
          {session ? 'Restart' : 'Start'}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void stopTerminal(config.id)}
          disabled={!isRunning}
        >
          <StopIcon size={18} /> Stop
        </button>
        <button type="button" className="button button--danger" onClick={requestClose}>
          <XIcon size={18} /> Close
        </button>
      </div>

      {confirmClose && (
        <ConfirmDialog
          title="Close running session?"
          body={`"${config.title}" is still running. Closing it will terminate the process.`}
          confirmLabel="Terminate and close"
          tone="danger"
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => {
            setConfirmClose(false)
            void closeTerminal(config.id)
          }}
        />
      )}
    </aside>
  )
}
