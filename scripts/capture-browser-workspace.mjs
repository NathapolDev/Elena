// A separate, disposable profile: never change the user's live projects.
/* global window, document */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect } from '@playwright/test'

const profile = mkdtempSync(join(tmpdir(), 'elena-browser-qa-'))
const destination = resolve(process.env.ELENA_QA_OUTPUT ?? 'test-results/browser-qa')
mkdirSync(destination, { recursive: true })
const root = process.cwd()
const terminal = (id, title) => ({ id, title, executable: 'pwsh.exe', args: ['-NoLogo', '-NoProfile'], cwd: root, envAllowlist: [] })
const now = new Date().toISOString()
const workspace = (id, name, terminals) => ({ id, name, projectRoot: root, terminals,
  layout: terminals.length ? { type: 'tabs', activeTabId: terminals[0].id, tabs: terminals.map((t) => ({ id: t.id, layout: { type: 'terminal', terminalId: t.id } })) } : null,
  ...(terminals.length ? { activeTerminalId: terminals[0].id } : {}), createdAt: now, updatedAt: now })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ schemaVersion: 2, settings: { gpuRendering: false, themePreference: 'dark', terminalFontSize: 16, terminalLineHeight: 1.4 } }))
writeFileSync(join(profile, 'workspaces.json'), JSON.stringify({ schemaVersion: 2, workspaces: [
  workspace('elena', 'Elena', [terminal('claude', 'Claude'), terminal('codex', 'Codex'), terminal('shell', 'Shell')]),
  workspace('api', 'API Service', [terminal('api-1', 'API agent'), terminal('api-2', 'Tests')]),
  workspace('docs', 'Docs', [terminal('docs-1', 'Writer')])
] }))
const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root, env: { ...process.env, ELENA_E2E: '1' } })
const errors = []
try {
  const page = await app.firstWindow()
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
  await expect(page.getByRole('tab', { name: 'Claude', exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.localStorage.setItem('elena.browser.v1', JSON.stringify({ openWorkspaceIds: ['elena', 'api', 'docs'], collapsedWorkspaceIds: ['api', 'docs'], activeWorkspaceId: 'elena' }))
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Expand project API Service' })).toBeVisible()
  await page.getByRole('tab', { name: 'Codex', exact: true }).click()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.locator('.browser-toolbar .badge')).toHaveText('Running')
  const input = page.locator('.xterm-helper-textarea')
  await input.focus()
  await input.type("Clear-Host; Write-Output 'OpenAI Codex  D:\\AI-WorkSpace'; Write-Output ''; Write-Output '> Simplify Elena into a browser-style agent workspace'; Write-Output 'Inspecting src/renderer/src/App.tsx'; Write-Output 'Inspecting components/BrowserChrome.tsx'; Write-Output ''; Write-Output 'Plan'; Write-Output '  Group session tabs by project'; Write-Output '  Keep the active terminal full width'; Write-Output '  Open saved projects without selecting a folder'; Write-Output ''; Write-Output 'Ready to refine the interface.'")
  await input.press('Enter')
  await expect(page.locator('.xterm-rows')).toContainText('Ready to refine the interface.')
  const metrics = []
  for (const [width, height] of [[1536, 981], [1488, 1058], [1180, 720]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height])
    await expect.poll(() => page.evaluate(([w, h]) => window.innerWidth === w && Math.abs(window.innerHeight - h) <= 1, [width, height])).toBe(true)
    await expect(page.getByRole('tab', { name: 'Codex', exact: true })).toBeVisible()
    // Wait for the registry's 60 ms fit debounce before capture.
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(destination, `dark-${width}x${height}.png`), scale: 'css' })
    await page.getByRole('button', { name: 'Saved projects', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Saved projects' })).toBeVisible()
    await page.screenshot({ path: join(destination, `saved-${width}x${height}.png`), scale: 'css' })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+,')
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.waitForTimeout(200)
    await page.screenshot({ path: join(destination, `light-${width}x${height}.png`), scale: 'css' })
    await page.keyboard.press('Control+,')
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    metrics.push(await page.evaluate(() => ({ viewport: [window.innerWidth, window.innerHeight], tabs: document.querySelector('.browser-tabs').getBoundingClientRect().height,
      toolbar: document.querySelector('.browser-toolbar').getBoundingClientRect().height, paneHeaders: document.querySelectorAll('.pane__header').length })))
  }
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(JSON.stringify({ destination, metrics, consoleErrors: errors }))
} finally {
  await app.close()
  const expectedParent = resolve(tmpdir())
  if (resolve(profile).startsWith(expectedParent + '\\') && profile.includes('elena-browser-qa-')) rmSync(profile, { recursive: true, force: true })
}
