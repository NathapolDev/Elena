import { useEffect, useState, version as reactVersion } from 'react'
import type { AppInfo } from '@shared/types'
import { call, describeError } from '../lib/api'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo }
  | { status: 'error'; message: string }

export function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let active = true

    void call('app:info')
      .then((info) => {
        if (active) setState({ status: 'ready', info })
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', message: describeError(error).body })
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="dialog about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        aria-describedby="about-status"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <img className="about-dialog__logo" src="./elena.png" alt="Elena logo" />
        <h2 className="dialog__title" id="about-title">
          About Elena
        </h2>

        <div id="about-status" aria-live="polite">
          {state.status === 'loading' && <p className="about-dialog__status">Loading version information…</p>}
          {state.status === 'error' && (
            <p className="about-dialog__status" role="alert">
              Could not load version information. {state.message}
            </p>
          )}
          {state.status === 'ready' && (
            <dl className="about-dialog__details">
              <div>
                <dt>Version</dt>
                <dd>{state.info.appVersion}</dd>
              </div>
              <div>
                <dt>Electron</dt>
                <dd>{state.info.electronVersion}</dd>
              </div>
              <div>
                <dt>React</dt>
                <dd>{reactVersion}</dd>
              </div>
              <div>
                <dt>Developed by</dt>
                <dd>{state.info.developer}</dd>
              </div>
            </dl>
          )}
        </div>

        {/* Outside the status block on purpose: OFL 1.1 attribution has to show
            even when the app:info call fails. */}
        <p className="about-dialog__legal">
          Terminal font: 0xProto Nerd Font Mono, © 2023 0xType Project Authors, SIL Open Font License 1.1.
        </p>

        <div className="dialog__actions">
          <button type="button" className="button button--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
