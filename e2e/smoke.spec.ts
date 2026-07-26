/**
 * End-to-end smoke over the built app.
 *
 * Covers the MVP acceptance criteria that only a real window can prove:
 * create a workspace, run a command in a real PTY, split panes, switch theme
 * without disturbing the session, restart, and quit without orphans.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
let projectRoot: string
let userData: string

// The smoke cases intentionally form one user journey and share the same
// workspace/process state. Stop at the first failure instead of restarting a
// worker with an empty profile and producing misleading cascade failures.
test.describe.configure({ mode: 'serial' })

function launchApp(): Promise<ElectronApplication> {
  const executablePath = process.env.AIWS_E2E_EXECUTABLE
  return electron.launch(
    executablePath
      ? { executablePath, args: [`--user-data-dir=${userData}`] }
      : { args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() }
  )
}

test.beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'aiws-e2e-project-'))
  userData = mkdtempSync(join(tmpdir(), 'aiws-e2e-userdata-'))
  writeFileSync(join(projectRoot, 'MARKER.txt'), 'do not delete me')

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
  await expect(page.locator('.pane').first().locator('.xterm-rows')).toContainText('E2E_MARKER_OK')

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
  await expect(paneBuffer).toContainText('E2E_MARKER_OK')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Done' }).click()

  // The buffer and the session survived both switches (FR-25).
  await expect(paneBuffer).toContainText('E2E_MARKER_OK')
  await expect(page.locator('.statusbar__health')).toContainText('4 sessions operational')

  const screenshotPath = process.env.AIWS_E2E_SCREENSHOT
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
  await expect(pane.locator('.xterm-rows')).not.toContainText('E2E_MARKER_OK')
})

test('creates, edits, duplicates, and deletes a custom preset', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'New preset', exact: true }).click()
  const editor = page.getByLabel('Preset editor')
  await editor.getByLabel('Name', { exact: true }).fill('E2E Agent')
  await editor.getByLabel('Executable').fill('pwsh.exe')
  await editor.getByLabel('Arguments (one per line)').fill('-NoLogo')
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
  await page.getByRole('button', { name: 'Delete E2E Agent Updated' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
})

test('restarting a session produces a new pid', async () => {
  await page.locator('.session-item').first().click()
  const pane = page.locator('.pane').first()
  const pidValue = page.locator('.inspector__details > div').filter({ has: page.getByText('PID', { exact: true }) }).locator('dd')
  const before = await pidValue.innerText()

  await pane.getByRole('button', { name: 'Restart' }).click()
  await expect
    .poll(
      async () => {
        const current = await pidValue.innerText()
        return current !== '—' && current !== before
      },
      { timeout: 30_000 }
    )
    .toBe(true)
})

test('closing a running session asks for confirmation', async () => {
  const pane = page.locator('.pane').first()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByLabel('Confirm before closing a running session')).toBeChecked()
  await page.getByRole('button', { name: 'Done' }).click()
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
