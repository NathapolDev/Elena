import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ConsoleMessage, ElectronApplication, Page } from '@playwright/test'

/** Shipped in the app, so it is the default with nothing installed. */
const BUNDLED_FONT = '0xProto Nerd Font Mono'

let app: ElectronApplication
let page: Page
let projectRoot: string
let userData: string

function launchApp(): Promise<ElectronApplication> {
  return electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
}

test.beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'elena-typography-project-'))
  userData = mkdtempSync(join(tmpdir(), 'elena-typography-userdata-'))
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('applies installed font metrics live, persists them, and resets to the original defaults', async () => {
  const consoleIssues: string[] = []
  const recordConsoleIssue = (message: ConsoleMessage): void => {
    if (message.type() === 'warning' || message.type() === 'error') consoleIssues.push(message.text())
  }
  page.on('console', recordConsoleIssue)

  await expect(page).toHaveTitle('Elena')
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)

  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await page.getByLabel('Name').fill('Typography Project')
  await page.getByLabel('Project root').fill(projectRoot)
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Open terminal' }).click()

  const pane = page.locator('.pane').first()
  const terminalRows = pane.locator('.xterm-rows')
  await pane.locator('.xterm-screen').click()
  await page.keyboard.type('echo TYPOGRAPHY_BUFFER_OK')
  await page.keyboard.press('Enter')
  await expect(terminalRows).toContainText('TYPOGRAPHY_BUFFER_OK', { timeout: 30_000 })
  const rowHeightBefore = await terminalRows.locator('> div').first().evaluate((row) => row.getBoundingClientRect().height)

  // The bundled Nerd Font is the default, with nothing installed and nothing
  // selected — that is the whole point of shipping it.
  await expect
    .poll(() => terminalRows.evaluate((rows) => getComputedStyle(rows).fontFamily))
    .toContain(BUNDLED_FONT)

  // Computed style names the family even if the .ttf never loaded. FontFaceSet
  // status is the only assertion that proves the file resolved under file://
  // and decoded — a broken path or a CSP rejection fails right here.
  const bundledFaces = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.family.includes('0xProto'))
      .map((face) => `${face.weight}/${face.style}/${face.status}`)
      .sort()
  )
  expect(bundledFaces).toEqual(['400/italic/loaded', '400/normal/loaded', '700/normal/loaded'])

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByLabel('Font family')).toHaveValue('')
  await expect(page.getByLabel('Font size')).toHaveValue('13')
  await expect(page.getByLabel('Line height')).toHaveValue('1.2')
  await page.getByRole('button', { name: 'Load installed fonts' }).click()

  const fontSelect = page.getByLabel('Font family')
  await expect.poll(() => fontSelect.locator('option').count()).toBeGreaterThan(1)
  const installedFamilies = await fontSelect.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value).filter(Boolean)
  )
  // Never pick the bundled family: on a machine that also has it installed, the
  // "font changed" assertion below would pass without anything having changed.
  const candidates = installedFamilies.filter((family) => family !== BUNDLED_FONT)
  const selectedFont =
    candidates.find((family) => ['Cascadia Mono', 'Consolas', 'Courier New'].includes(family)) ??
    candidates[0]!

  await fontSelect.selectOption(selectedFont)
  await page.getByLabel('Font size').fill('15')
  await page.getByLabel('Line height').fill('1.4')

  await expect
    .poll(() => terminalRows.evaluate((rows) => getComputedStyle(rows).fontFamily))
    .toContain(selectedFont)
  await expect.poll(() => terminalRows.evaluate((rows) => getComputedStyle(rows).fontSize)).toBe('15px')
  await expect
    .poll(() => terminalRows.locator('> div').first().evaluate((row) => row.getBoundingClientRect().height))
    .toBeGreaterThan(rowHeightBefore)

  const screenshotPath = process.env.ELENA_E2E_TYPOGRAPHY_SCREENSHOT
  if (screenshotPath) await page.screenshot({ path: screenshotPath })

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(terminalRows).toContainText('TYPOGRAPHY_BUFFER_OK')

  await app.close()
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('console', recordConsoleIssue)

  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByLabel('Font family')).toHaveValue(selectedFont)
  await expect(page.getByLabel('Font size')).toHaveValue('15')
  await expect(page.getByLabel('Line height')).toHaveValue('1.4')

  await page.getByRole('button', { name: 'Reset typography' }).click()
  await expect(page.getByLabel('Font family')).toHaveValue('')
  await expect(page.getByLabel('Font size')).toHaveValue('13')
  await expect(page.getByLabel('Line height')).toHaveValue('1.2')
  expect(consoleIssues).toEqual([])
})
