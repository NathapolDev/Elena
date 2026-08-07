import { useEffect, useState, version as reactVersion } from 'react'
import type { AppInfo, UpdateState } from '@shared/types'
import { call, describeError } from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'
import { useStore } from '../state/store'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo }
  | { status: 'error'; message: string }

type Props = {
  updateState: UpdateState | null
  onCheck: () => Promise<void>
  onClose: () => void
}

export function AboutDialog({ updateState, onCheck, onClose }: Props): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [confirmInstall, setConfirmInstall] = useState(false)
  const pushError = useStore((store) => store.pushError)

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

  const checkLabel = updateState?.status === 'error' ? 'Retry' : 'Check for updates'
  const checking = updateState?.status === 'checking'
  const downloading = updateState?.status === 'downloading'

  const install = async (): Promise<void> => {
    setConfirmInstall(false)
    try {
      await call('app:update-install')
    } catch (error) {
      pushError(error)
    }
  }

  return (
    <>
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

        <section className="about-dialog__update" aria-labelledby="update-title">
          <h3 id="update-title">Updates</h3>
          <UpdateStatus state={updateState} />
          {downloading && (
            <progress
              aria-label="Update download progress"
              max={100}
              value={updateState.percent}
            />
          )}
          {updateState?.status === 'ready' ? (
            <button type="button" className="button button--primary" onClick={() => setConfirmInstall(true)}>
              Restart &amp; Install
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={!updateState || checking || downloading || (updateState.status === 'idle' && !updateState.supported)}
              onClick={() => void onCheck().catch(pushError)}
            >
              {checking ? 'Checking…' : downloading ? 'Downloading…' : checkLabel}
            </button>
          )}
        </section>

        <div className="dialog__actions">
          <button type="button" className="button button--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      </div>
      {confirmInstall && updateState?.status === 'ready' && (
        <ConfirmDialog
          title="Restart and install update?"
          body={`Elena will close all running terminals, install version ${updateState.latestVersion} silently, and reopen. Unsaved terminal work will be lost.`}
          confirmLabel="Restart & Install"
          onCancel={() => setConfirmInstall(false)}
          onConfirm={() => void install()}
        />
      )}
    </>
  )
}

function UpdateStatus({ state }: { state: UpdateState | null }): React.JSX.Element {
  if (!state) return <p className="about-dialog__update-status">Loading update status…</p>

  switch (state.status) {
    case 'idle':
      return (
        <p className="about-dialog__update-status">
          {state.supported
            ? `Elena ${state.currentVersion} is ready to check for updates.`
            : 'Automatic updates are available in installed Windows builds.'}
        </p>
      )
    case 'checking':
      return <p className="about-dialog__update-status">Checking for updates…</p>
    case 'up-to-date':
      return <p className="about-dialog__update-status">Elena {state.currentVersion} is up to date.</p>
    case 'downloading':
      return (
        <p className="about-dialog__update-status">
          Downloading Elena {state.latestVersion}… {Math.round(state.percent)}%
        </p>
      )
    case 'ready':
      return <p className="about-dialog__update-status">Elena {state.latestVersion} is ready to install.</p>
    case 'error':
      return (
        <p className="about-dialog__update-status about-dialog__update-status--error" role="alert">
          Could not check for updates. {state.message}
        </p>
      )
  }
}
