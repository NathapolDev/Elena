/**
 * Stands in for a terminal that is currently showing in its own window.
 *
 * The layout leaf is kept rather than removed, so detaching costs no change to
 * the persisted workspace and bringing the terminal back restores its exact
 * position. The process itself is untouched throughout — only the window
 * drawing it changed.
 */
import { ArrowsInSimpleIcon } from '@phosphor-icons/react/ArrowsInSimple'
import { MonitorIcon } from '@phosphor-icons/react/Monitor'
import { useStore } from '../state/store'
import { StatusBadge } from './StatusBadge'
import type { TerminalConfig } from '@shared/types'

type Props = {
  config: TerminalConfig
}

export function DetachedPanePlaceholder({ config }: Props): React.JSX.Element {
  const session = useStore((s) => s.sessions[config.id])
  const reattachTerminal = useStore((s) => s.reattachTerminal)

  return (
    <section className="pane pane--detached" aria-label={`Terminal ${config.title}, in a separate window`}>
      <header className="pane__header">
        <div className="pane__identity">
          <span className="pane__title">{config.title}</span>
          <StatusBadge {...(session ? { session } : {})} />
        </div>
      </header>
      <div className="pane__detached-body">
        <MonitorIcon size={28} aria-hidden="true" />
        <p className="pane__detached-text">
          Showing in a separate window. The session keeps running; this pane resumes from live output when
          you bring it back.
        </p>
        <button type="button" className="button" onClick={() => void reattachTerminal(config.id)}>
          <ArrowsInSimpleIcon size={17} /> Bring back
        </button>
      </div>
    </section>
  )
}
