import { useState } from 'react'
import { useStore } from '../state/store'
import type { AgentPreset, ThemePreference } from '@shared/types'

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

type PresetDraft = Omit<AgentPreset, 'id' | 'builtIn'>

const EMPTY_PRESET: PresetDraft = {
  name: '',
  executable: '',
  args: [],
  defaultCwd: '',
  envAllowlist: []
}

export function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const shells = useStore((s) => s.shells)
  const presets = useStore((s) => s.presets)
  const updateSettings = useStore((s) => s.updateSettings)
  const createPreset = useStore((s) => s.createPreset)
  const updatePreset = useStore((s) => s.updatePreset)
  const deletePreset = useStore((s) => s.deletePreset)
  const resetPresets = useStore((s) => s.resetPresets)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PresetDraft>(EMPTY_PRESET)
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')

  const edit = (preset?: AgentPreset): void => {
    const next = preset
      ? {
          name: preset.name,
          executable: preset.executable,
          args: preset.args,
          defaultCwd: preset.defaultCwd,
          envAllowlist: preset.envAllowlist,
          ...(preset.installHint ? { installHint: preset.installHint } : {})
        }
      : EMPTY_PRESET
    setEditingId(preset?.id ?? 'new')
    setDraft(next)
    setArgsText(next.args.join('\n'))
    setEnvText(next.envAllowlist.join('\n'))
  }

  const duplicate = (preset: AgentPreset): void => {
    edit({ ...preset, id: 'new', name: `${preset.name} Copy`, builtIn: false })
  }

  const savePreset = async (): Promise<void> => {
    const input: PresetDraft = {
      ...draft,
      name: draft.name.trim(),
      executable: draft.executable.trim(),
      args: argsText.split('\n').map((value) => value.trim()).filter(Boolean),
      envAllowlist: envText.split(/[\n,]/).map((value) => value.trim()).filter(Boolean)
    }
    if (!input.name) return
    const saved = editingId === 'new' ? await createPreset(input) : await updatePreset(editingId!, input)
    if (saved) setEditingId(null)
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title" id="settings-title">
          Settings
        </h2>

        <div className="dialog__row">
          <label id="theme-label">Theme</label>
          <div className="segmented" role="group" aria-labelledby="theme-label">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="segmented__option"
                aria-pressed={settings.themePreference === option.value}
                onClick={() => void updateSettings({ themePreference: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            System follows Windows and updates live.
          </span>
        </div>

        <div className="dialog__row">
          <label htmlFor="default-shell">Default shell</label>
          <select
            id="default-shell"
            value={settings.defaultShellId ?? ''}
            onChange={(event) => void updateSettings({ defaultShellId: event.target.value || null })}
          >
            <option value="">First available</option>
            {shells.map((shell) => (
              <option key={shell.id} value={shell.id}>
                {shell.name}
              </option>
            ))}
          </select>
        </div>

        <div className="dialog__row">
          <label htmlFor="scrollback">Scrollback lines</label>
          <input
            id="scrollback"
            type="number"
            min={1000}
            max={200000}
            step={1000}
            value={settings.scrollback}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value) && value >= 1000 && value <= 200000) {
                void updateSettings({ scrollback: value })
              }
            }}
          />
        </div>

        <div className="dialog__row">
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settings.confirmCloseRunning}
              onChange={(event) => void updateSettings({ confirmCloseRunning: event.target.checked })}
            />
            Confirm before closing a running session
          </label>
          <label style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={settings.warnOnMultilinePaste}
              onChange={(event) => void updateSettings({ warnOnMultilinePaste: event.target.checked })}
            />
            Warn before pasting multiple lines
          </label>
        </div>

        <div className="dialog__row">
          <div className="dialog__inline dialog__inline--spread">
            <label>Agent presets</label>
            <div className="dialog__inline">
              <button type="button" className="button" onClick={() => edit()}>
                New preset
              </button>
              <button type="button" className="button" onClick={() => void resetPresets()}>
                Reset built-ins
              </button>
            </div>
          </div>
          <ul className="preset-list">
            {presets.map((preset) => (
              <li key={preset.id}>
                <span>
                  <strong>{preset.name}</strong> — <code>{preset.executable || 'not configured'}</code>
                  {preset.builtIn ? ' (built-in)' : ''}
                </span>
                <span className="dialog__inline">
                  <button type="button" className="button" onClick={() => edit(preset)} aria-label={`Edit ${preset.name}`}>
                    Edit
                  </button>
                  <button type="button" className="button" onClick={() => duplicate(preset)} aria-label={`Duplicate ${preset.name}`}>
                    Duplicate
                  </button>
                  {!preset.builtIn && (
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => void deletePreset(preset.id)}
                      aria-label={`Delete ${preset.name}`}
                    >
                      Delete
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {editingId !== null && (
          <div className="preset-editor" aria-label="Preset editor">
            <h3>{editingId === 'new' ? 'New preset' : 'Edit preset'}</h3>
            <label>
              Name
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label>
              Executable
              <input
                value={draft.executable}
                onChange={(event) => setDraft({ ...draft, executable: event.target.value })}
                placeholder="codex"
              />
            </label>
            <label>
              Arguments (one per line)
              <textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={3} />
            </label>
            <label>
              Default working directory (relative to project root)
              <input
                value={draft.defaultCwd}
                onChange={(event) => setDraft({ ...draft, defaultCwd: event.target.value })}
              />
            </label>
            <label>
              Environment variable names (one per line)
              <textarea value={envText} onChange={(event) => setEnvText(event.target.value)} rows={3} />
            </label>
            <div className="dialog__actions">
              <button type="button" className="button" onClick={() => setEditingId(null)}>
                Cancel
              </button>
              <button type="button" className="button button--primary" disabled={!draft.name.trim()} onClick={() => void savePreset()}>
                Save preset
              </button>
            </div>
          </div>
        )}

        <div className="dialog__actions">
          <button type="button" className="button button--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
