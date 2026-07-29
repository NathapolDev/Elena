import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BUNDLED_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_SIZE } from '@shared/terminalTypography'
import { App } from './App'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

/**
 * A bundled face decodes from local disk in a few milliseconds. This cap only
 * exists so a corrupt or missing font file degrades to the fallback stack
 * instead of leaving the user staring at an empty window.
 */
const FONT_GATE_TIMEOUT_MS = 1500

function mount(): void {
  createRoot(container as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

/**
 * xterm measures the cell box exactly once, from a canvas measureText() taken
 * when the Terminal is constructed, and has no font-load hook of its own —
 * CharSizeService re-measures only when fontFamily/fontSize actually change.
 * Mount before the bundled face has decoded and every terminal is sized against
 * the fallback: wrong cols/rows go to the ConPTY and the grid stays misaligned
 * until something forces a re-fit. Waiting here is the cheapest fix, because
 * TerminalPane cannot construct a Terminal before App renders.
 *
 * All three faces are requested explicitly: document.fonts.load() only fetches
 * faces matching the given shorthand, so loading the regular face alone would
 * leave bold and italic undecoded and let a bold-heavy first frame measure wrong.
 *
 * document.fonts.load() resolves with [] when nothing matches rather than
 * rejecting, and rejects only on a malformed shorthand — mount on both, since a
 * missing font is a far better outcome than a blank window. The
 * document.fonts.ready re-measure in App.tsx covers the case where the gate
 * resolves early (in dev, Vite injects the stylesheet asynchronously, so the
 * @font-face rules may not exist yet when this runs).
 */
const family = `"${BUNDLED_TERMINAL_FONT_FAMILY}"`
const bundledFacesReady = Promise.all([
  document.fonts.load(`${DEFAULT_TERMINAL_FONT_SIZE}px ${family}`),
  document.fonts.load(`bold ${DEFAULT_TERMINAL_FONT_SIZE}px ${family}`),
  document.fonts.load(`italic ${DEFAULT_TERMINAL_FONT_SIZE}px ${family}`)
])

void Promise.race([
  bundledFacesReady,
  new Promise((resolve) => setTimeout(resolve, FONT_GATE_TIMEOUT_MS))
]).then(mount, mount)
