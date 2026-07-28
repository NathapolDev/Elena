/**
 * Choose a shell or an agent preset, a working directory and how the new
 * terminal joins the layout (FR-07, FR-09, FR-15).
 *
 * The executable is checked before the session is created, so a missing CLI
 * produces an actionable message instead of a failed spawn (FR-17).
 */
import { useMemo, useState } from 'react'
import { call, describeError } from '../lib/api'
import { useStore } from '../state/store'
import type { Workspace } from '@shared/types'

type Props = {
  workspace: Workspace
  onClose: () => void
}

type Source =
  | { kind: 'shell'; id: string }
  | { kind: 'preset'; id: string }
  | { kind: 'custom' }

export function NewTerminalDialog({ workspace, onClose }: Props): React.JSX.Element {
  const shells = useStore((s) => s.shells)
  const presets = useStore((s) => s.presets)
  const defaultShellId = useStore((s) => s.settings.defaultShellId)
  const activeTerminalId = useStore((s) => s.activeTerminalId)
  const addTerminal = useStore((s) => s.addTerminal)

  const initialShell = shells.find((s) => s.id === defaultShellId) ?? shells[0]
  const [source, setSource] = useState<Source>(
    initialShell ? { kind: 'shell', id: initialShell.id } : { kind: 'custom' }
  )
  const [cwd, setCwd] = useState(workspace.projectRoot)
  const [placement, setPlacement] = useState<'grid' | 'tab' | 'horizontal' | 'vertical'>('grid')
  const [customExecutable, setCustomExecutable] = useState('')
  const [customArgs, setCustomArgs] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selection = useMemo(() => {
    if (source.kind === 'shell') {
      const shell = shells.find((s) => s.id === source.id)
      return shell
        ? { title: shell.name, executable: shell.executable, args: shell.args, envAllowlist: [] as string[] }
        : null
    }
    if (source.kind === 'preset') {
      const preset = presets.find((p) => p.id === source.id)
      return preset
        ? {
            title: preset.name,
            executable: preset.executable,
            args: preset.args,
            envAllowlist: preset.envAllowlist,
            presetId: preset.id,
            installHint: preset.installHint
          }
        : null
    }
    return {
      title: customExecutable ? customExecutable.split(/[\\/]/).pop() ?? 'Custom' : 'Custom',
      executable: customExecutable,
      args: splitArgs(customArgs),
      envAllowlist: [] as string[]
    }
  }, [customArgs, customExecutable, presets, shells, source])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!selection || busy) return
    if (!selection.executable) {
      setError('This preset has no executable configured yet. Set one in Settings → Presets.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      // The cwd defaults to the project root; anything else is validated
      // against it so a session cannot silently start outside the workspace.
      const validatedCwd = await call('path:validate', { path: cwd, mustBeInside: workspace.projectRoot })
      await addTerminal({
        title: selection.title,
        executable: selection.executable,
        args: selection.args,
        cwd: validatedCwd.path,
        envAllowlist: selection.envAllowlist,
        ...('presetId' in selection && selection.presetId ? { presetId: selection.presetId } : {}),
        ...(placement === 'grid' ? { spatialGrid: true } : {}),
        ...(placement === 'horizontal' || placement === 'vertical' ? { split: placement } : {})
      })
      onClose()
    } catch (err) {
      const described = describeError(err)
      const hint = selection && 'installHint' in selection && selection.installHint ? ` ${selection.installHint}` : ''
      setError(`${described.body}${hint}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="dialog"
        aria-labelledby="new-terminal-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2 className="dialog__title" id="new-terminal-title">
          New terminal
        </h2>

        <div className="dialog__row">
          <label htmlFor="terminal-source">Shell or agent</label>
          <select
            id="terminal-source"
            autoFocus
            value={`${source.kind}:${'id' in source ? source.id : ''}`}
            onChange={(event) => {
              const [kind, id] = event.target.value.split(':')
              if (kind === 'custom') {
                setSource({ kind: 'custom' })
                setCwd(workspace.projectRoot)
              } else if (kind === 'shell' && id) {
                setSource({ kind: 'shell', id })
                setCwd(workspace.projectRoot)
              } else if (kind === 'preset' && id) {
                const preset = presets.find((item) => item.id === id)
                setSource({ kind: 'preset', id })
                setCwd(preset?.defaultCwd || workspace.projectRoot)
              }
            }}
          >
            <optgroup label="Shells">
              {shells.map((shell) => (
                <option key={shell.id} value={`shell:${shell.id}`}>
                  {shell.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Agent presets">
              {presets.map((preset) => (
                <option key={preset.id} value={`preset:${preset.id}`}>
                  {preset.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Other">
              <option value="custom:">Custom command…</option>
            </optgroup>
          </select>
        </div>

        {source.kind === 'custom' && (
          <>
            <div className="dialog__row">
              <label htmlFor="custom-executable">Executable</label>
              <input
                id="custom-executable"
                value={customExecutable}
                onChange={(event) => setCustomExecutable(event.target.value)}
                placeholder="node"
                required
              />
            </div>
            <div className="dialog__row">
              <label htmlFor="custom-args">Arguments</label>
              <input
                id="custom-args"
                value={customArgs}
                onChange={(event) => setCustomArgs(event.target.value)}
                placeholder="--version"
              />
            </div>
          </>
        )}

        <div className="dialog__row">
          <label htmlFor="terminal-cwd">Working directory</label>
          <div className="dialog__inline">
            <input id="terminal-cwd" value={cwd} onChange={(event) => setCwd(event.target.value)} required />
            <button
              type="button"
              className="button"
              onClick={() => {
                void call('dialog:pick-directory', { defaultPath: workspace.projectRoot }).then((picked) => {
                  if (picked) setCwd(picked.path)
                })
              }}
            >
              Browse…
            </button>
          </div>
        </div>

        <div className="dialog__row">
          <label id="placement-label">Placement</label>
          <div className="segmented" role="group" aria-labelledby="placement-label">
            {(
              [
                ['grid', 'Next grid slot'],
                ['tab', 'New tab'],
                ['horizontal', 'Split right'],
                ['vertical', 'Split down']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="segmented__option"
                aria-pressed={placement === value}
                onClick={() => setPlacement(value)}
                disabled={value !== 'tab' && !activeTerminalId}
              >
                {label}
              </button>
            ))}
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
          <button type="submit" className="button button--primary" disabled={busy}>
            Open terminal
          </button>
        </div>
      </form>
    </div>
  )
}

/** Splits an argument string on whitespace, honouring double quotes. */
function splitArgs(input: string): string[] {
  const matches = input.match(/"[^"]*"|\S+/g) ?? []
  return matches.map((arg) => arg.replace(/^"|"$/g, ''))
}
