import { useMemo, useState } from 'react'
import {
  BUNDLED_TERMINAL_FONT_FAMILY,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  MAX_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_LINE_HEIGHT,
  MIN_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_LINE_HEIGHT,
  terminalFontStack
} from '@shared/terminalTypography'
import { loadInstalledFontFamilies } from '../lib/terminalTypography'
import { useStore } from '../state/store'

export function TerminalTypographySettings(): React.JSX.Element {
  const settings = useStore((state) => state.settings)
  const updateSettings = useStore((state) => state.updateSettings)
  const [fontFamilies, setFontFamilies] = useState<readonly string[] | null>(null)
  const [fontFilter, setFontFilter] = useState('')
  const [fontError, setFontError] = useState<string | null>(null)
  const [loadingFonts, setLoadingFonts] = useState(false)

  const visibleFamilies = useMemo(() => {
    if (!fontFamilies) return []
    const query = fontFilter.trim().toLocaleLowerCase()
    return query
      ? fontFamilies.filter((family) => family.toLocaleLowerCase().includes(query))
      : fontFamilies
  }, [fontFamilies, fontFilter])

  const loadFonts = async (): Promise<void> => {
    setLoadingFonts(true)
    setFontError(null)
    try {
      const families = await loadInstalledFontFamilies()
      setFontFamilies(families)
      if (families.length === 0) setFontError('No installed fonts were returned by the system.')
    } catch (error) {
      setFontError(error instanceof Error ? error.message : 'Installed fonts could not be loaded.')
    } finally {
      setLoadingFonts(false)
    }
  }

  const selectedFamilyIsHidden =
    settings.terminalFontFamily !== null && !visibleFamilies.includes(settings.terminalFontFamily)

  return (
    <div className="dialog__row terminal-typography" aria-labelledby="terminal-typography-label">
      <label id="terminal-typography-label">Terminal typography</label>

      <div className="terminal-typography__font">
        <label htmlFor="terminal-font">Font family</label>
        <div className="dialog__inline terminal-typography__font-actions">
          <button type="button" className="button" disabled={loadingFonts} onClick={() => void loadFonts()}>
            {loadingFonts ? 'Loading fonts…' : 'Load installed fonts'}
          </button>
          <button
            type="button"
            className="button"
            disabled={settings.terminalFontFamily === null}
            onClick={() => void updateSettings({ terminalFontFamily: null })}
          >
            Use default font
          </button>
        </div>

        {fontFamilies !== null && (
          <input
            type="search"
            aria-label="Search installed fonts"
            placeholder="Search installed fonts"
            value={fontFilter}
            onChange={(event) => setFontFilter(event.target.value)}
          />
        )}

        <select
          id="terminal-font"
          value={settings.terminalFontFamily ?? ''}
          onChange={(event) => void updateSettings({ terminalFontFamily: event.target.value || null })}
        >
          {/*
            The bundled face is never returned by queryLocalFonts, but it needs no
            entry of its own: the empty value already resolves to it through
            DEFAULT_TERMINAL_FONT_STACK. A separate option would look identical
            while persisting a redundant family name, which would make "Use
            default font" and "Reset typography" appear to do nothing.
          */}
          <option value="">{BUNDLED_TERMINAL_FONT_FAMILY} (bundled)</option>
          {selectedFamilyIsHidden && (
            <option value={settings.terminalFontFamily ?? ''}>{settings.terminalFontFamily} (selected)</option>
          )}
          {visibleFamilies.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>

        {fontError && (
          <span className="terminal-typography__message" role="alert">
            {fontError}
          </span>
        )}
      </div>

      <div className="terminal-typography__metrics">
        <label htmlFor="terminal-font-size">
          Font size
          <input
            id="terminal-font-size"
            type="number"
            min={MIN_TERMINAL_FONT_SIZE}
            max={MAX_TERMINAL_FONT_SIZE}
            step={1}
            value={settings.terminalFontSize}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (
                Number.isInteger(value) &&
                value >= MIN_TERMINAL_FONT_SIZE &&
                value <= MAX_TERMINAL_FONT_SIZE
              ) {
                void updateSettings({ terminalFontSize: value })
              }
            }}
          />
        </label>

        <label htmlFor="terminal-line-height">
          Line height
          <input
            id="terminal-line-height"
            type="number"
            min={MIN_TERMINAL_LINE_HEIGHT}
            max={MAX_TERMINAL_LINE_HEIGHT}
            step={0.1}
            value={settings.terminalLineHeight}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (
                Number.isFinite(value) &&
                value >= MIN_TERMINAL_LINE_HEIGHT &&
                value <= MAX_TERMINAL_LINE_HEIGHT
              ) {
                void updateSettings({ terminalLineHeight: value })
              }
            }}
          />
        </label>
      </div>

      <div
        className="terminal-typography__preview"
        style={{
          fontFamily: terminalFontStack(settings.terminalFontFamily),
          fontSize: `${settings.terminalFontSize}px`,
          lineHeight: settings.terminalLineHeight
        }}
        aria-label="Terminal font preview"
      >
        AaBb 0123 {'{}'} [] ~/ terminal
      </div>

      <div className="dialog__inline terminal-typography__footer">
        <span>
          Defaults: {BUNDLED_TERMINAL_FONT_FAMILY}, {DEFAULT_TERMINAL_FONT_SIZE} px, line height{' '}
          {DEFAULT_TERMINAL_LINE_HEIGHT}
        </span>
        <button
          type="button"
          className="button"
          disabled={
            settings.terminalFontFamily === null &&
            settings.terminalFontSize === DEFAULT_TERMINAL_FONT_SIZE &&
            settings.terminalLineHeight === DEFAULT_TERMINAL_LINE_HEIGHT
          }
          onClick={() =>
            void updateSettings({
              terminalFontFamily: null,
              terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
              terminalLineHeight: DEFAULT_TERMINAL_LINE_HEIGHT
            })
          }
        >
          Reset typography
        </button>
      </div>
    </div>
  )
}
