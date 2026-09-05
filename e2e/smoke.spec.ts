/**
 * End-to-end smoke over the built app.
 *
 * Covers the MVP acceptance criteria that only a real window can prove:
 * create a workspace, run a command in a real PTY, split panes, switch theme
 * without disturbing the session, restart, and quit without orphans.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ConsoleMessage, ElectronApplication, Page } from '@playwright/test'
import { version as reactVersion } from 'react'
import { seedE2eSettings } from './settings'

let app: ElectronApplication
let page: Page
let projectRoot: string
let userData: string

// The smoke cases intentionally form one user journey and share the same
// workspace/process state. Stop at the first failure instead of restarting a
// worker with an empty profile and producing misleading cascade failures.
test.describe.configure({ mode: 'serial' })

function launchApp(): Promise<ElectronApplication> {
  const executablePath = process.env.ELENA_E2E_EXECUTABLE
  return electron.launch(
    executablePath
      ? { executablePath, args: [`--user-data-dir=${userData}`], env: { ...process.env, ELENA_E2E: '1' } }
      : {
          args: ['.', `--user-data-dir=${userData}`],
          cwd: process.cwd(),
          env: { ...process.env, ELENA_E2E: '1' }
        }
  )
}

test.beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'elena-e2e-project-'))
  userData = mkdtempSync(join(tmpdir(), 'elena-e2e-userdata-'))
  seedE2eSettings(userData)
  writeFileSync(join(projectRoot, 'MARKER.txt'), 'do not delete me')
  mkdirSync(join(projectRoot, 'preset-cwd'))
  execFileSync('git', ['-C', projectRoot, 'init'], { stdio: 'ignore' })
  execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Elena E2E'], { stdio: 'ignore' })
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'elena@example.invalid'], { stdio: 'ignore' })
  execFileSync('git', ['-C', projectRoot, 'add', 'MARKER.txt'], { stdio: 'ignore' })
  execFileSync('git', ['-C', projectRoot, 'commit', '-m', 'fixture'], { stdio: 'ignore' })
  writeFileSync(join(projectRoot, 'MARKER.txt'), 'do not delete me\nchanged in e2e\n')
  writeFileSync(join(projectRoot, 'UNTRACKED.txt'), 'untracked in e2e\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('creates a workspace bound to an existing folder', async () => {
  await expect(page.getByText('No workspace yet')).toBeVisible()

  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await page.getByLabel('Name').fill('E2E Project')
  await page.getByLabel('Project root').fill(projectRoot)
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()

  await expect(page.getByText('No terminals in this workspace yet')).toBeVisible()
})

test('renames the workspace', async () => {
  await page.getByRole('button', { name: 'Rename workspace' }).click()
  await page.getByLabel('Workspace name').fill('E2E Project Renamed')
  await page.getByRole('button', { name: 'Save name' }).click()

  await expect(page.locator('.commandbar__title')).toHaveText('E2E Project Renamed')
  // Every workspace is listed; the renamed one is the selected row.
  await expect(page.locator('.workspace-item--active .workspace-item__name')).toHaveText('E2E Project Renamed')
})

test('hides, restores and resizes the sidebar', async () => {
  const sidebar = page.locator('.sidebar')
  const widthBefore = (await sidebar.boundingBox())!.width

  await page.keyboard.press('Control+KeyB')
  await expect(sidebar).toHaveCount(0)
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(sidebar).toBeVisible()

  const resizer = page.getByRole('separator', { name: 'Resize sidebar' })
  await resizer.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(widthBefore)

  await resizer.dblclick()
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(widthBefore)
})

test('opens a shell and runs a command in a real PTY', async () => {
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Open terminal' }).click()

  const pane = page.locator('.pane').first()
  await expect(pane).toBeVisible()
  await expect(pane.getByText(/Running/)).toBeVisible()

  await pane.locator('.xterm-screen').click()
  await page.keyboard.type('echo E2E_MARKER_OK')
  await page.keyboard.press('Enter')

  await expect(pane.locator('.xterm-rows')).toContainText('E2E_MARKER_OK', { timeout: 30_000 })
})

test('views changed files without disturbing the running terminal', async () => {
  const pane = page.locator('.pane').first()
  await expect(pane.getByText(/Running/)).toBeVisible()
  const changesButton = page.getByRole('button', { name: 'View changed files' })
  await expect(changesButton.locator('.changes-trigger__added')).toHaveText('+3')
  await expect(changesButton.locator('.changes-trigger__deleted')).toHaveText('−1')

  await page.getByRole('button', { name: 'View changed files' }).click()
  const dialog = page.getByRole('dialog', { name: 'Changed files' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('MARKER.txt', { exact: true })).toBeVisible()
  await expect(dialog.getByText('UNTRACKED.txt', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Open MARKER.txt in VS Code' })).toBeEnabled()

  await dialog.locator('.changes__file-select').filter({ hasText: 'MARKER.txt' }).click()
  await expect(dialog.getByRole('region', { name: 'Working tree unified diff' })).toContainText('+changed in e2e')

  writeFileSync(join(projectRoot, 'REFRESHED.txt'), 'created while the dialog is open\n')
  writeFileSync(join(projectRoot, 'MARKER.txt'), 'do not delete me\n+++\nrefreshed diff\n')
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(dialog.getByText('REFRESHED.txt', { exact: true })).toBeVisible()
  const preview = dialog.getByRole('region', { name: 'Working tree unified diff' })
  await expect(preview).toContainText('+refreshed diff')
  await expect(preview).not.toContainText('+changed in e2e')
  const signs = preview.locator('.changes__line').filter({ hasText: '++++' })
  await expect(signs).toHaveClass(/changes__line--addition/)
  await expect(signs.locator('.changes__line-number').nth(1)).toHaveText('2')

  writeFileSync(join(projectRoot, 'MARKER.txt'), 'do not delete me\nupdated on focus\n')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(preview).toContainText('+updated on focus')
  await expect(preview).not.toContainText('+refreshed diff')

  writeFileSync(join(projectRoot, 'MARKER.txt'), 'before\n---\nlast\n')
  execFileSync('git', ['-C', projectRoot, 'add', 'MARKER.txt'], { stdio: 'ignore' })
  writeFileSync(join(projectRoot, 'MARKER.txt'), 'before\n+++\nextra\nlast\n')
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(preview).toContainText('+extra')
  await expect(preview).not.toContainText('diff --git')
  await expect(preview).not.toContainText('--- a/MARKER.txt')
  await dialog.getByRole('button', { name: 'Side by side', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Side by side', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const split = dialog.getByRole('region', { name: 'Working tree side by side diff' })
  await expect(split).not.toContainText('diff --git')
  await expect(split).not.toContainText('+++ b/MARKER.txt')
  const replacement = split.locator('.changes__split-row').filter({ hasText: '++++' })
  await expect(replacement.locator('.changes__split-cell--left')).toContainText('----')
  await expect(replacement.locator('.changes__split-cell--right')).toContainText('++++')
  await expect(replacement.locator('.changes__line-number')).toHaveText(['2', '2'])
  const extra = split.locator('.changes__split-row').filter({ hasText: '+extra' })
  await expect(extra.locator('.changes__split-cell--left')).toHaveClass(/changes__line--empty/)
  await expect(extra.locator('.changes__split-cell--right .changes__line-number')).toHaveText('3')
  const left = (await replacement.locator('.changes__split-cell--left').boundingBox())!
  const right = (await replacement.locator('.changes__split-cell--right').boundingBox())!
  expect(right.x).toBeGreaterThan(left.x)
  expect(right.y).toBe(left.y)
  await page.screenshot({ path: test.info().outputPath('side-by-side.png') })
  writeFileSync(join(projectRoot, 'REFRESHED.txt'), 'x\n'.repeat(20000))
  const largePreviewStart = Date.now()
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
  await dialog.locator('.changes__file-select').filter({ hasText: 'REFRESHED.txt' }).click()
  const largePreview = dialog.getByRole('region', { name: 'Untracked side by side diff' })
  await expect(largePreview.locator('.changes__split-row')).toHaveCount(1999)
  await expect(dialog.getByText(/Showing the first 2,000 diff lines/)).toBeVisible()
  await expect(largePreview).not.toContainText('diff --git')
  process.stdout.write(`large diff E2E (20,000 source lines, 2,000 display lines): ${Date.now() - largePreviewStart} ms\n`)
  writeFileSync(join(projectRoot, 'REFRESHED.txt'), 'created while the dialog is open\n')
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
  await dialog.locator('.changes__file-select').filter({ hasText: 'MARKER.txt' }).click()
  await dialog.getByRole('button', { name: 'Unified', exact: true }).click()
  await expect(preview).toContainText('+extra')
  await expect(split).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Close changed files' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(changesButton.locator('.changes-trigger__added')).toHaveText('+7')
  await expect(changesButton.locator('.changes-trigger__deleted')).toHaveText('−2')
  writeFileSync(join(projectRoot, 'UNTRACKED.txt'), 'untracked in e2e\nanother line\n')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(changesButton.locator('.changes-trigger__added')).toHaveText('+8')
  await page.screenshot({ path: test.info().outputPath('changes-counts.png') })
  await expect(pane.getByText(/Running/)).toBeVisible()
  await expect(pane.locator('.xterm-rows')).toContainText('E2E_MARKER_OK')
})

test('shows runtime About information without changing the workspace or sessions', async () => {
  const consoleIssues: string[] = []
  const recordConsoleIssue = (message: ConsoleMessage): void => {
    if (message.type() === 'warning' || message.type() === 'error') consoleIssues.push(message.text())
  }
  page.on('console', recordConsoleIssue)

  await expect(page).toHaveTitle('Elena')
  expect(page.url()).toMatch(/^file:/)
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)

  const workspaceTitle = await page.locator('.commandbar__title').textContent()
  const paneCount = await page.locator('.pane').count()
  const versions = await app.evaluate(({ app: electronApp }) => ({
    appVersion: electronApp.getVersion(),
    electronVersion: process.versions.electron
  }))

  const aboutButton = page.getByRole('button', { name: 'About Elena' })
  await expect(aboutButton).toHaveClass(/icon-button/)
  await expect(aboutButton).toHaveText('')
  await expect(aboutButton.locator('svg')).toHaveCount(1)
  await aboutButton.click()
  const dialog = page.getByRole('dialog', { name: 'About Elena' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('img', { name: 'Elena logo' })).toBeVisible()
  await expect(dialog.getByText('NathapolDev', { exact: true })).toBeVisible()
  await expect(dialog.getByText(versions.appVersion, { exact: true })).toBeVisible()
  await expect(dialog.getByText(versions.electronVersion, { exact: true })).toBeVisible()
  await expect(dialog.getByText(reactVersion, { exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Updates' })).toBeVisible()
  await expect(dialog.getByText('Automatic updates are available in installed Windows builds.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Check for updates' })).toBeDisabled()

  const screenshotPath = process.env.ELENA_E2E_ABOUT_SCREENSHOT
  if (screenshotPath) await page.screenshot({ path: screenshotPath })

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.commandbar__title')).toHaveText(workspaceTitle ?? '')
  await expect(page.locator('.pane')).toHaveCount(paneCount)
  await expect(page.locator('.pane').first().getByText(/Running/)).toBeVisible()

  await page.getByRole('button', { name: 'About Elena' }).click()
  await page.locator('.dialog-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('dialog', { name: 'About Elena' })).toHaveCount(0)
  await expect(page.locator('.pane')).toHaveCount(paneCount)
  expect(consoleIssues).toEqual([])
  page.off('console', recordConsoleIssue)
})

test('keeps the requested compact chrome hidden', async () => {
  const nativeMenuState = await app.evaluate(({ BrowserWindow, Menu }) => ({
    applicationMenuIsNull: Menu.getApplicationMenu() === null,
    menuBarVisible: BrowserWindow.getAllWindows()[0]?.isMenuBarVisible() ?? true
  }))
  expect(nativeMenuState).toEqual({ applicationMenuIsNull: true, menuBarVisible: false })

  await expect(page.getByRole('button', { name: 'Command Palette' })).toHaveCount(0)
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(page.locator('.statusbar__actions')).toHaveCount(0)
  await expect(page.locator('.statusbar')).toHaveCount(0)

  const appBottom = await page.locator('.app').evaluate((element) => element.getBoundingClientRect().bottom)
  const mainBottom = await page.locator('.app__main').evaluate((element) => element.getBoundingClientRect().bottom)
  expect(mainBottom).toBeCloseTo(appBottom, 0)
})

test('zooms the window with Ctrl++ and Ctrl+-', async () => {
  const initialWidth = await page.evaluate(() => window.innerWidth)

  await page.keyboard.press('Control+Equal')
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(initialWidth)
  await expect(page.locator('.pane').first()).toBeVisible()

  await page.keyboard.press('Control+Minus')
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(initialWidth)
})

test('copies a terminal selection and pastes clipboard text with Ctrl+C and Ctrl+V', async () => {
  const pane = page.locator('.pane').first()

  await pane.getByRole('button', { name: 'More session actions' }).click()
  await pane.getByRole('menuitem', { name: 'Select all' }).click()
  await pane.locator('.xterm-helper-textarea').focus()
  await page.keyboard.press('Control+KeyC')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('E2E_MARKER_OK')

  await page.evaluate(() => navigator.clipboard.writeText("Write-Output ('E2E_' + 'PASTE_RESULT')"))
  await pane.locator('.xterm-screen').click()
  await page.keyboard.press('Control+KeyV')
  await expect(pane.locator('.xterm-rows')).toContainText('PASTE_RESULT', { timeout: 30_000 })
  await page.keyboard.press('Enter')
  await expect(pane.locator('.xterm-rows')).toContainText('E2E_PASTE_RESULT', { timeout: 30_000 })

  await expect(pane.locator('.xterm-selection div')).toHaveCount(0)
  const terminalRows = pane.locator('.xterm-rows')
  // The sleep outlives this test, so the command below can only ever run if
  // Ctrl+C without a selection reached the PTY as an interrupt.
  await page.keyboard.type('Write-Output E2E_INTERRUPT_STARTED; Start-Sleep -Seconds 300')
  await page.keyboard.press('Enter')
  await expect(terminalRows).toContainText('E2E_INTERRUPT_STARTED', { timeout: 30_000 })

  // The renderer turns Ctrl+C without a selection into \x03 on the PTY, but
  // ConPTY only raises a console interrupt from that byte while the shell holds
  // the console in processed-input mode — a window a loaded runner can miss,
  // leaving the shell asleep with no prompt and nothing else to observe. Repeat
  // the keystroke the way a user would; a Ctrl+C that never interrupts still
  // fails here, because the sleep outlives every timeout in this test.
  //
  // Match the prompt rather than counting prompts: xterm exposes only the
  // rendered viewport, so the prompt an interrupt produces pushes an older one
  // off the top and the total never moves. The tail is the assertion's value so
  // a failure reports what the shell was actually showing.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Control+KeyC')
        return (await terminalRows.innerText()).trimEnd().split('\n').slice(-3).join('\n')
      },
      { timeout: 30_000 }
    )
    .toMatch(/^PS [^>\n]*>\s*$/m)

  const terminalInput = pane.locator('.xterm-helper-textarea')
  await terminalInput.focus()
  await expect(terminalInput).toBeFocused()
  await terminalInput.pressSequentially("Write-Output ('E2E_' + 'INTERRUPT_OK')", { delay: 10 })
  await terminalInput.press('Enter')
  await expect(terminalRows).toContainText('E2E_INTERRUPT_OK', { timeout: 30_000 })
})

test('splits into a second pane with independent sessions', async () => {
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Split right' }).click()
  await page.getByRole('button', { name: 'Open terminal' }).click()

  await expect(page.locator('.pane')).toHaveCount(2)
  await expect(page.locator('.split__divider')).toHaveCount(1)
  await expect(page.locator('.workspace-item--active .workspace-item__meta')).toHaveText('2 sessions')
})

test('fills the remaining spatial grid slots', async () => {
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Open terminal' }).click()
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Open terminal' }).click()

  await expect(page.getByRole('tablist', { name: 'Terminal tabs' })).toHaveCount(0)
  await expect(page.locator('.pane')).toHaveCount(4)
  await expect(page.locator('.split__divider')).toHaveCount(3)
  await expect(page.getByRole('tab', { name: '1–4' })).toHaveAttribute('aria-selected', 'true')
  // xterm exposes only the rendered viewport through the DOM. Use the newest
  // marker so a smaller CI viewport does not mistake valid scrollback for loss.
  await expect(page.locator('.pane').first().locator('.xterm-rows')).toContainText('E2E_INTERRUPT_OK')

  // Selecting a session changes focus without hiding the rest of the workspace.
  await page.locator('.session-item').nth(3).click()
  await expect(page.locator('.session-item').nth(3)).toHaveClass(/session-item--active/)
  await expect(page.locator('.pane')).toHaveCount(4)
  await page.locator('.session-item').first().click()
  await expect(page.locator('.session-item').first()).toHaveClass(/session-item--active/)
  await expect(page.locator('.pane')).toHaveCount(4)
})

test('renames a terminal without disturbing its session', async () => {
  // Rename the second configured session. A later test closes the first one,
  // then the relaunch test verifies this custom name came back from disk.
  await page.locator('.session-item').nth(1).click()
  const pane = page.locator('.pane--active')
  const before = await pane.locator('.badge').first().innerText()

  await page.keyboard.press('F2')
  await page.getByLabel('Terminal name').fill('Build Watcher')
  await page.getByRole('button', { name: 'Save name' }).click()

  await expect(pane.locator('.pane__title')).toHaveText('Build Watcher')
  await expect(page.locator('.session-item__title').nth(1)).toHaveText('Build Watcher')
  // A rename is a label change only: the pid is untouched.
  await expect(pane.locator('.badge').first()).toHaveText(before)

  // F2 targets the focused terminal and reaches the same dialog.
  await page.keyboard.press('F2')
  await expect(page.getByLabel('Terminal name')).toHaveValue('Build Watcher')
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('switches theme without disturbing the running session', async () => {
  const paneBuffer = page.locator('.pane').first().locator('.xterm-rows')
  await expect(paneBuffer).toContainText('E2E_INTERRUPT_OK')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const darkTokens = await page.locator('html').evaluate((element) => {
    const styles = getComputedStyle(element)
    const token = (name: string): string => styles.getPropertyValue(name).trim()
    return {
      background: token('--bg'),
      foreground: token('--text-primary'),
      red: token('--status-error'),
      yellow: token('--status-waiting'),
      green: token('--status-running'),
      cyan: token('--active-terminal'),
      blue: token('--primary'),
      purple: token('--term-magenta'),
      terminalBackground: token('--term-bg'),
      terminalForeground: token('--term-fg')
    }
  })
  expect(darkTokens).toEqual({
    background: '#282c34',
    foreground: '#dcdfe4',
    red: '#e06c75',
    yellow: '#e5c07b',
    green: '#98c379',
    cyan: '#56b6c2',
    blue: '#61afef',
    purple: '#c678dd',
    terminalBackground: '#282c34',
    terminalForeground: '#dcdfe4'
  })
  await page.getByRole('button', { name: 'Done' }).click()

  // The buffer and the session survived both switches (FR-25).
  await expect(paneBuffer).toContainText('E2E_INTERRUPT_OK')
  await expect(page.locator('.session-item__meta').filter({ hasText: 'Running' })).toHaveCount(4)

  const screenshotPath = process.env.ELENA_E2E_SCREENSHOT
  if (screenshotPath) {
    await page.setViewportSize({ width: 1488, height: 1058 })
    await page.screenshot({ path: screenshotPath })
  }
})

test('selects all and clears terminal output', async () => {
  const pane = page.locator('.pane').first()
  await pane.getByRole('button', { name: 'More session actions' }).click()
  await pane.getByRole('menuitem', { name: 'Select all' }).click()
  await expect(pane.locator('.xterm-selection div')).not.toHaveCount(0)
  await pane.getByRole('button', { name: 'More session actions' }).click()
  await pane.getByRole('menuitem', { name: 'Clear' }).click()
  await expect(pane.locator('.xterm-rows')).not.toContainText('E2E_INTERRUPT_OK')
})

test('creates, edits, launches, duplicates, and deletes a custom preset', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'New preset', exact: true }).click()
  const editor = page.getByLabel('Preset editor')
  await editor.getByLabel('Name', { exact: true }).fill('E2E Agent')
  await editor.getByLabel('Executable').fill('pwsh.exe')
  await editor.getByLabel('Arguments (one per line)').fill('-NoLogo')
  await editor.getByLabel('Default working directory (relative to project root)').fill('preset-cwd')
  await editor.getByRole('button', { name: 'Save preset' }).click()
  await expect(page.getByText('E2E Agent', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Edit E2E Agent' }).click()
  await editor.getByLabel('Name', { exact: true }).fill('E2E Agent Updated')
  await editor.getByRole('button', { name: 'Save preset' }).click()
  await expect(page.getByText('E2E Agent Updated', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Duplicate E2E Agent Updated' }).click()
  await editor.getByRole('button', { name: 'Save preset' }).click()
  await expect(page.getByText('E2E Agent Updated Copy', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Delete E2E Agent Updated Copy' }).click()
  await expect(page.getByText('E2E Agent Updated Copy', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByLabel('Shell or agent').selectOption({ label: 'E2E Agent Updated' })
  await expect(page.getByLabel('Working directory')).toHaveValue('preset-cwd')
  await page.getByRole('button', { name: 'Open terminal' }).click()

  const presetPane = page.locator('.pane--active')
  await expect(presetPane.locator('.pane__cwd')).toContainText('cwd: preset-cwd')
  await presetPane.getByRole('button', { name: 'More session actions' }).click()
  await presetPane.getByRole('menuitem', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Terminate and close' }).click()
  await expect(page.locator('.pane')).toHaveCount(4)

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Delete E2E Agent Updated' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
})

test('restarting a session produces a new pid', async () => {
  await page.locator('.session-item').first().click()
  const pane = page.locator('.pane').first()

  await pane.locator('.xterm-screen').click()
  await page.keyboard.type('echo E2E_PID_$PID')
  await page.keyboard.press('Enter')
  await expect(pane.locator('.xterm-rows')).toContainText(/E2E_PID_\d+/, { timeout: 30_000 })
  const beforeText = await pane.locator('.xterm-rows').innerText()
  const before = [...beforeText.matchAll(/E2E_PID_(\d+)/g)].at(-1)?.[1]
  expect(before).toBeTruthy()

  await pane.getByRole('button', { name: 'Restart' }).click()
  await expect(pane.locator('.badge').first()).toContainText('Running', { timeout: 30_000 })
  await pane.locator('.xterm-screen').click()
  await page.keyboard.type('echo E2E_PID_$PID')
  await page.keyboard.press('Enter')
  await expect(pane.locator('.xterm-rows')).toContainText(/E2E_PID_\d+/, { timeout: 30_000 })
  const afterText = await pane.locator('.xterm-rows').innerText()
  const after = [...afterText.matchAll(/E2E_PID_(\d+)/g)].at(-1)?.[1]
  expect(after).toBeTruthy()
  expect(after).not.toBe(before)
})

test('closing a running session asks for confirmation', async () => {
  const pane = page.locator('.pane').first()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByLabel('Confirm before closing a running session')).toBeChecked()
  await page.getByRole('button', { name: 'Done' }).click()

  await pane.locator('.xterm-screen').click()
  await page.keyboard.press('Control+KeyW')
  await expect(page.getByRole('alertdialog')).toContainText('is still running')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.pane')).toHaveCount(4)

  await page.keyboard.press('Control+KeyK')
  await page.getByLabel('Search commands').fill('Close focused terminal')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alertdialog')).toContainText('is still running')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.pane')).toHaveCount(4)

  await pane.getByRole('button', { name: 'More session actions' }).click()
  await pane.getByRole('menuitem', { name: 'Close' }).click()

  await expect(page.getByRole('alertdialog')).toContainText('is still running')
  await page.getByRole('button', { name: 'Terminate and close' }).click()

  await expect(page.locator('.pane')).toHaveCount(3)
})

test('the command palette opens with Ctrl+K and runs a command', async () => {
  await page.keyboard.press('Control+KeyK')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  await page.getByLabel('Search commands').fill('Theme: Light')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('layout and configuration are restored on relaunch, processes are not', async () => {
  await app.close()

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await expect(page.locator('.commandbar__title')).toHaveText('E2E Project Renamed')
  await expect(page.locator('.pane')).toHaveCount(3)
  await expect(page.getByRole('tablist', { name: 'Terminal tabs' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '1–3' })).toHaveAttribute('aria-selected', 'true')
  // Restore returns configuration only. A new process starts only after an
  // explicit user action (FR-14).
  const restoredPane = page.locator('.pane').filter({ has: page.getByText('Build Watcher', { exact: true }) })
  // The custom terminal name is part of the persisted workspace, not the process.
  await expect(restoredPane.locator('.pane__title')).toHaveText('Build Watcher')
  await expect(restoredPane.locator('.badge').first()).toContainText('Not started')
  await restoredPane.getByRole('button', { name: 'Start' }).click()
  await expect(restoredPane.locator('.badge').first()).toContainText('Running')
})
