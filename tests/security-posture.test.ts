/**
 * Guard suite: the renderer security posture (NFR-10, NFR-17, NFR-18, NFR-19).
 *
 * A failure here means the posture was relaxed, not that the test is stale.
 * Do not "fix" it by loosening an assertion — AGENTS.md says the posture is
 * fixed, and if a feature needs more, the feature is wrong.
 *
 * COVERAGE GAP: these are the values, not the wiring. That
 * `applyContentSecurityPolicy` actually installs the header via
 * `session.webRequest`, and that `hardenWebContents` actually registers
 * `setWindowOpenHandler` / `will-navigate` / `will-attach-webview`, is only
 * observable at runtime and is not asserted anywhere. If that wiring is ever
 * touched, verify it by hand against a packaged build.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BROWSER_WINDOW_WEB_PREFERENCES,
  contentSecurityPolicy,
  isAllowedExternalUrl,
  isAllowedNavigationUrl
} from '../src/main/security/posture'

describe('webPreferences', () => {
  it('keeps the renderer sandboxed and Node-free', () => {
    expect(BROWSER_WINDOW_WEB_PREFERENCES).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false
    })
  })

  it('carries no escape hatch', () => {
    const forbidden = [
      'allowRunningInsecureContent',
      'experimentalFeatures',
      'enableBlinkFeatures',
      'webSecurity',
      'nodeIntegrationInSubFrames'
    ]
    const keys = Object.keys(BROWSER_WINDOW_WEB_PREFERENCES)
    expect(keys.filter((key) => forbidden.includes(key))).toEqual([])
  })

  it('is the object every window is actually built from', () => {
    // The extraction is only worth anything if the windows still spread it.
    // Checking every construction site — not one named file — is what stops a
    // second window (detached panes, a future dialog) being born relaxed.
    const files = readdirSync(join(process.cwd(), 'src/main'), { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(process.cwd(), 'src/main', name))

    const builders = files.filter((file) => readFileSync(file, 'utf8').includes('new BrowserWindow('))
    expect(builders.length).toBeGreaterThan(0)
    for (const file of builders) {
      const source = readFileSync(file, 'utf8')
      const constructions = source.split('new BrowserWindow(').length - 1
      const spreads = source.split('...BROWSER_WINDOW_WEB_PREFERENCES').length - 1
      expect(spreads, `${file} builds ${constructions} window(s) but spreads the posture ${spreads} time(s)`).toBe(
        constructions
      )
    }
  })

  it('still installs the policy and the navigation guards', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    expect(source).toContain('contentSecurityPolicy(isDev)')
    expect(source).toContain('isAllowedExternalUrl(url)')
    expect(source).toContain('isAllowedNavigationUrl(url,')
  })
})

describe('content security policy', () => {
  const packaged = contentSecurityPolicy(false)

  it('locks the packaged policy down', () => {
    expect(packaged).toContain("default-src 'self'")
    expect(packaged).toContain("object-src 'none'")
    expect(packaged).toContain("frame-ancestors 'none'")
  })

  it.each(["'unsafe-eval'", 'ws:', 'http:', 'blob:'])(
    'keeps %s out of the packaged policy',
    (token) => {
      expect(packaged).not.toContain(token)
    }
  )

  it("allows inline styles but not inline scripts when packaged", () => {
    expect(packaged).toContain("style-src 'self' 'unsafe-inline'")
    expect(packaged).toContain("script-src 'self';")
  })

  it('relaxes the dev policy on purpose, and only in dev', () => {
    // Asserted explicitly so the dev/packaged split stays visible: the branch
    // keys off `!app.isPackaged`, so anything that convinces the app it is in
    // dev also gets this policy.
    const dev = contentSecurityPolicy(true)
    expect(dev).toContain("'unsafe-eval'")
    expect(dev).toContain('ws:')
    expect(dev).not.toBe(packaged)
  })
})

describe('navigation and external links', () => {
  it.each(['http://example.com', 'file:///C:/x.html', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x'])(
    'refuses to open %s externally',
    (url) => {
      expect(isAllowedExternalUrl(url)).toBe(false)
    }
  )

  it('opens https links externally', () => {
    expect(isAllowedExternalUrl('https://github.com/NathapolDev/Elena')).toBe(true)
  })

  it('allows only the packaged bundle outside dev', () => {
    expect(isAllowedNavigationUrl('file:///C:/app/index.html', false, undefined)).toBe(true)
    expect(isAllowedNavigationUrl('https://evil.example', false, undefined)).toBe(false)
    // A dev server URL must not be honoured in a packaged build.
    expect(isAllowedNavigationUrl('http://localhost:5173/', false, 'http://localhost:5173')).toBe(false)
  })

  it('allows the dev server only in dev', () => {
    expect(isAllowedNavigationUrl('http://localhost:5173/index.html', true, 'http://localhost:5173')).toBe(true)
    expect(isAllowedNavigationUrl('https://evil.example', true, 'http://localhost:5173')).toBe(false)
  })
})
