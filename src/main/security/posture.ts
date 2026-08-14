/**
 * The renderer security posture as plain values (NFR-18).
 *
 * `src/main/index.ts` bootstraps the app at import time (single-instance lock,
 * `app.on` wiring), so it cannot be imported from a test. Keeping the posture
 * here — Electron-free, no side effects — is what lets
 * `tests/security-posture.test.ts` assert it instead of grepping for strings.
 *
 * These are the values, not the wiring. That `applyContentSecurityPolicy` really
 * installs the header and that `hardenWebContents` really registers the handlers
 * is only provable at runtime; see the COVERAGE GAP note in that test.
 */

/**
 * Sandbox on, context isolation on, Node off. Do not relax any of these to make
 * something work — find another way.
 */
export const BROWSER_WINDOW_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  webviewTag: false,
  spellcheck: false
} as const

const DEV_CSP =
  "default-src 'self' 'unsafe-inline' data: blob: ws: http://localhost:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*"

const PACKAGED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/**
 * In dev the Vite client needs inline styles and a websocket back to the dev
 * server; the packaged app gets the strict policy. The split keys off
 * `!app.isPackaged`, so anything that convinces the app it is running in dev
 * also relaxes the CSP.
 */
export function contentSecurityPolicy(isDev: boolean): string {
  return isDev ? DEV_CSP : PACKAGED_CSP
}

/** External links open in the user's browser, never in an app window. */
export function isAllowedExternalUrl(url: string): boolean {
  return url.startsWith('https://')
}

/** Only the dev server (in dev) or the packaged bundle may be navigated to. */
export function isAllowedNavigationUrl(
  url: string,
  isDev: boolean,
  devServerUrl: string | undefined
): boolean {
  return isDev && devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
}
