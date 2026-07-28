import { useState } from 'react'
import { call, describeError } from '../lib/api'
import { useStore } from '../state/store'

type Props = {
  onClose: () => void
}

export function NewWorkspaceDialog({ onClose }: Props): React.JSX.Element {
  const createWorkspace = useStore((s) => s.createWorkspace)
  const [name, setName] = useState('')
  const [projectRoot, setProjectRoot] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pickFolder = async (): Promise<void> => {
    try {
      const picked = await call('dialog:pick-directory', {})
      if (!picked) return
      setProjectRoot(picked.path)
      if (!name.trim()) setName(picked.path.split(/[\\/]/).filter(Boolean).pop() ?? 'Workspace')
      setError(null)
    } catch (err) {
      setError(describeError(err).body)
    }
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Validate before creating so the error names the actual problem (FR-23).
      await call('path:validate', { path: projectRoot })
      const workspace = await createWorkspace(name.trim(), projectRoot)
      if (workspace) onClose()
      else setError('Could not create the workspace.')
    } catch (err) {
      setError(describeError(err).body)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="dialog"
        aria-labelledby="new-workspace-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="dialog__title" id="new-workspace-title">
          New workspace
        </h2>

        <div className="dialog__row">
          <label htmlFor="workspace-name">Name</label>
          <input
            id="workspace-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My project"
            required
            maxLength={120}
          />
        </div>

        <div className="dialog__row">
          <label htmlFor="workspace-root">Project root</label>
          <div className="dialog__inline">
            <input
              id="workspace-root"
              value={projectRoot}
              onChange={(event) => setProjectRoot(event.target.value)}
              placeholder="D:\\projects\\my-app"
              required
            />
            <button type="button" className="button" onClick={() => void pickFolder()}>
              Browse…
            </button>
          </div>
        </div>

        {error && (
          <p className="dialog__error" role="alert">
            {error}
          </p>
        )}

        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy || !name.trim() || !projectRoot}>
            Create workspace
          </button>
        </div>
      </form>
    </div>
  )
}
