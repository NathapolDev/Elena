import { useState } from 'react'
import { useStore } from '../state/store'
import type { Workspace } from '@shared/types'

type Props = {
  workspace: Workspace
  onClose: () => void
}

export function RenameWorkspaceDialog({ workspace, onClose }: Props): React.JSX.Element {
  const renameWorkspace = useStore((state) => state.renameWorkspace)
  const [name, setName] = useState(workspace.name)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName) return
    if (nextName === workspace.name) {
      onClose()
      return
    }

    setBusy(true)
    const renamed = await renameWorkspace(workspace.id, nextName)
    setBusy(false)
    if (renamed) onClose()
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="dialog"
        aria-labelledby="rename-workspace-title"
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title" id="rename-workspace-title">
          Rename workspace
        </h2>
        <div className="dialog__row">
          <label htmlFor="rename-workspace-name">Workspace name</label>
          <input
            id="rename-workspace-name"
            autoFocus
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>
            Save name
          </button>
        </div>
      </form>
    </div>
  )
}
