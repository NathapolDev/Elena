import { useState } from 'react'
import { useStore } from '../state/store'
import type { TerminalConfig } from '@shared/types'

type Props = {
  terminal: TerminalConfig
  onClose: () => void
}

export function RenameTerminalDialog({ terminal, onClose }: Props): React.JSX.Element {
  const renameTerminal = useStore((state) => state.renameTerminal)
  const [title, setTitle] = useState(terminal.title)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const nextTitle = title.trim()
    if (!nextTitle) return
    if (nextTitle === terminal.title) {
      onClose()
      return
    }

    setBusy(true)
    const renamed = await renameTerminal(terminal.id, nextTitle)
    setBusy(false)
    if (renamed) onClose()
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="dialog"
        aria-labelledby="rename-terminal-title"
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title" id="rename-terminal-title">
          Rename terminal
        </h2>
        <div className="dialog__row">
          <label htmlFor="rename-terminal-name">Terminal name</label>
          <input
            id="rename-terminal-name"
            autoFocus
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {/* The name is a label only: it never changes what the session runs. */}
          <p className="dialog__hint">
            Renaming affects the pane header and the session list. The running process is not touched.
          </p>
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy || !title.trim()}>
            Save name
          </button>
        </div>
      </form>
    </div>
  )
}
