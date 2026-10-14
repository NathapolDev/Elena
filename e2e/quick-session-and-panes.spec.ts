/** Browser tab groups, bookmarks, background sessions and temporary split views. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { seedE2eSettings } from './settings'
import { action, configureSession, launchTestApp, newProject, renameSession, savedProject } from './browser-helpers'

let app: ElectronApplication
let page: Page
let projectRoot: string
let userData: string
let secondRoot: string
let missingRoot: string
let firstPid: number | undefined
const issues: string[] = []

test.describe.configure({ mode: 'serial' })
function launch(): Promise<ElectronApplication> {
  return launchTestApp(userData)
}

async function sessions(): Promise<Array<{ terminalId: string; pid?: number; status: string }>> {
  return page.evaluate(async () => {
    const result = await window.elena.invoke('terminal:list-sessions', undefined)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  })
}
async function shell(name: string): Promise<void> {
  await configureSession(page)
  await page.getByRole('button', { name: 'Open terminal' }).click()
  await expect(page.locator('.browser-toolbar .badge')).toHaveText('Running')
  await renameSession(page, name)
}
async function quickShell(name: string): Promise<void> {
  const shellName = await page.evaluate(async () => {
    const result = await window.elena.invoke('shell:list', undefined)
    if (!result.ok || !result.data[0]) throw new Error('No test shell available')
    return result.data[0].name
  })
  await page.locator('.browser-tabs').getByRole('button', { name: 'New session', exact: true }).click()
  await page.locator('.chrome-popover__list').getByRole('button', { name: shellName, exact: true }).click()
  await expect(page.locator('.browser-toolbar .badge')).toHaveText('Running')
  await renameSession(page, name)
}
async function command(value: string): Promise<void> {
  await page.locator('.pane .xterm-helper-textarea').focus()
  await page.keyboard.type(value)
  await page.keyboard.press('Enter')
}

test.beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'elena-browser-a-'))
  secondRoot = mkdtempSync(join(tmpdir(), 'elena-browser-b-'))
  missingRoot = mkdtempSync(join(tmpdir(), 'elena-browser-missing-'))
  userData = mkdtempSync(join(tmpdir(), 'elena-browser-profile-'))
  seedE2eSettings(userData)
  app = await launch()
  page = await app.firstWindow()
  page.on('console', (message) => { if (['warning', 'error'].includes(message.type())) issues.push(message.text()) })
  await page.waitForLoadState('domcontentloaded')
})
test.afterAll(async () => {
  await app?.close()
  for (const path of [projectRoot, secondRoot, missingRoot, userData]) rmSync(path, { recursive: true, force: true })
})

test('creates projects once and adds shell sessions as browser tabs', async () => {
  await newProject(page, 'Elena', projectRoot)
  await shell('Claude')
  firstPid = (await sessions()).find((s) => s.status === 'running')?.pid
  expect(firstPid).toBeTruthy()
  await command("Write-Output ('BROWSER_' + 'BUFFER_OK')")
  await expect(page.locator('.xterm-rows')).toContainText('BROWSER_BUFFER_OK')
  await quickShell('Codex')
  await quickShell('Shell')
  await expect(page.locator('.browser-tab')).toHaveCount(3)
  await expect(page.locator('.pane')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  await expect(page.locator('.xterm-rows')).toContainText('BROWSER_BUFFER_OK')
  await expect(page.locator('.sidebar')).toHaveCount(0)
})

test('collapse and expand keep the active terminal and all process IDs', async () => {
  const before = await sessions()
  await page.getByRole('button', { name: 'Collapse project Elena' }).click()
  await expect(page.locator('.browser-tab')).toHaveCount(0)
  await expect(page.locator('.xterm-rows')).toContainText('BROWSER_BUFFER_OK')
  expect(await sessions()).toEqual(before)
  await page.getByRole('button', { name: 'Expand project Elena' }).click()
  await expect(page.locator('.browser-tab')).toHaveCount(3)
})

test('closing a project keeps agents running and collects new output', async () => {
  await command("Start-Sleep -Seconds 3; Write-Output ('BACKGROUND_' + 'RESULT')")
  await action(page, 'Close project')
  await expect(page.getByText('No project open', { exact: true })).toBeVisible()
  await expect(page.locator('.project-group')).toHaveCount(0)
  await expect.poll(async () => (await sessions()).some((s) => s.pid === firstPid && s.status === 'running')).toBe(true)
  await page.getByRole('button', { name: 'Saved projects', exact: true }).click()
  const saved = page.locator('.saved-project').filter({ hasText: 'Elena' })
  await expect(saved).toContainText('3 running')
  await expect(saved).toContainText('New output', { timeout: 15000 })
  await page.getByRole('button', { name: 'Open project Elena', exact: true }).click()
  await expect(page.locator('.xterm-rows')).toContainText('BACKGROUND_RESULT')
  expect((await sessions()).find((s) => s.pid === firstPid)?.status).toBe('running')
  await expect(page.locator('.browser-tab')).toHaveCount(3)
})

test('saved projects reopen without a picker or duplicate workspaces', async () => {
  await newProject(page, 'API Service', secondRoot)
  await shell('API agent')
  await savedProject(page, 'Elena')
  await savedProject(page, 'Elena')
  await expect(page.locator('.project-group')).toHaveCount(2)
  const count = await page.evaluate(async () => {
    const result = await window.elena.invoke('workspace:list', undefined)
    return result.ok ? result.data.length : -1
  })
  expect(count).toBe(2)
  await page.keyboard.press('Control+Shift+KeyF')
  await expect(page.getByLabel('Search saved projects')).toBeFocused()
  await page.getByLabel('Search saved projects').fill('api')
  await expect(page.locator('.saved-project')).toHaveCount(1)
  await page.getByLabel('Search saved projects').fill(secondRoot)
  await expect(page.locator('.saved-project')).toHaveCount(1)
  await page.keyboard.press('Escape')
})

test('split right and below are temporary views with continuous buffers', async () => {
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  const layout = await page.evaluate(async () => {
    const result = await window.elena.invoke('workspace:list', undefined)
    return result.ok ? result.data.find((w) => w.name === 'Elena')?.layout : null
  })
  await page.getByRole('button', { name: 'Split terminal' }).click()
  await page.getByRole('dialog', { name: 'Split terminal' }).getByRole('button', { name: 'Codex', exact: true }).click()
  await expect(page.locator('.split--horizontal')).toHaveCount(1)
  await expect(page.locator('.pane')).toHaveCount(2)
  await expect(page.locator('.pane').first().locator('.xterm-rows')).toContainText('BACKGROUND_RESULT')
  const separator = page.getByRole('separator', { name: 'Resize panes' })
  await separator.focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '60')
  const divider = (await separator.boundingBox())!
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="separator"]')?.getAttribute('aria-label'), { x: divider.x + divider.width / 2, y: divider.y + divider.height / 2 })
  expect(hit).toBe('Resize panes')
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
  await page.mouse.down()
  await page.mouse.move(divider.x + 70, divider.y + divider.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(separator).not.toHaveAttribute('aria-valuenow', '60')
  await page.getByRole('button', { name: 'Return to single terminal' }).click()
  await page.getByRole('button', { name: 'Split terminal' }).click()
  await page.getByRole('button', { name: 'Below', exact: true }).click()
  await page.getByRole('dialog', { name: 'Split terminal' }).getByRole('button', { name: 'Codex', exact: true }).click()
  await expect(page.locator('.split--vertical')).toHaveCount(1)
  const after = await page.evaluate(async () => {
    const result = await window.elena.invoke('workspace:list', undefined)
    return result.ok ? result.data.find((w) => w.name === 'Elena')?.layout : null
  })
  expect(after).toEqual(layout)
  await page.getByRole('tab', { name: 'API agent', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Claude', exact: true }).click()
  await expect(page.locator('.pane')).toHaveCount(1)
})

test('all tabs searches sessions and unfolds a selected project', async () => {
  await page.getByRole('button', { name: 'Collapse project API Service' }).click()
  await page.getByRole('button', { name: 'All tabs', exact: true }).click()
  await page.getByLabel('Search open tabs').fill('API')
  await expect(page.locator('.all-tab')).toHaveCount(1)
  await page.locator('.all-tab').click()
  await expect(page.getByRole('tab', { name: 'API agent', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('button', { name: 'Collapse project API Service' })).toBeVisible()
})

test('the search shortcut dismisses a modal before moving focus', async () => {
  await page.keyboard.press('Control+Shift+KeyN')
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+Shift+KeyF')
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Search saved projects')).toBeFocused()
  await page.keyboard.press('Escape')
})

test('a missing bookmarked folder stays saved and shows an actionable error', async () => {
  await newProject(page, 'Missing Folder', missingRoot)
  await action(page, 'Close project')
  rmSync(missingRoot, { recursive: true, force: true })
  await savedProject(page, 'Missing Folder')
  await expect(page.locator('.toast')).toContainText('not usable')
  await expect(page.locator('.project-group__name').filter({ hasText: 'Missing Folder' })).toHaveCount(0)
  await page.keyboard.press('Control+KeyB')
  await expect(page.getByRole('button', { name: 'Open project Missing Folder', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('delete saved project confirms, removes configuration and keeps project files', async () => {
  writeFileSync(join(secondRoot, 'MARKER.txt'), 'keep this file')
  await page.keyboard.press('Control+KeyB')
  await page.getByRole('button', { name: 'Delete saved project API Service', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toContainText('Running sessions will stop')
  await page.getByRole('button', { name: 'Delete saved project', exact: true }).click()
  await expect(page.locator('.project-group__name')).toHaveText('Elena')
  expect(readFileSync(join(secondRoot, 'MARKER.txt'), 'utf8')).toBe('keep this file')
})

test('relaunch restores open and collapsed groups, never processes or detached placement', async () => {
  await page.getByRole('button', { name: 'Collapse project Elena' }).click()
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('button', { name: 'Expand project Elena' })).toBeVisible()
  await expect(page.locator('.browser-toolbar .badge')).toHaveText('Not started')
  expect(await sessions()).toHaveLength(0)
  await expect(page.locator('.pane')).toHaveCount(1)
  await page.getByRole('button', { name: 'Expand project Elena' }).click()
  await expect(page.locator('.browser-tab')).toHaveCount(3)
  await expect(page.getByRole('tab', { name: 'Claude', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('closing all groups survives relaunch while bookmarks remain available', async () => {
  await action(page, 'Close project')
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByText('No project open', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open saved project', exact: true }).click()
  await expect(page.locator('.saved-project')).toHaveCount(2)
  await page.getByRole('button', { name: 'Open project Elena', exact: true }).click()
  await expect(page.locator('.browser-tab')).toHaveCount(3)
  await expect(page.locator('.browser-toolbar .badge')).toHaveText('Not started')
})

test('browser tabs fit minimum window size and keyboard navigation selects sessions', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1180, 720))
  await page.getByRole('tab', { name: 'Claude', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Codex', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'All tabs', exact: true }).click()
  await page.getByLabel('Search open tabs').fill('no matching session')
  await expect(page.getByText('No matches.', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'All tabs', exact: true })).toBeFocused()
  const viewport = await page.evaluate(() => window.innerWidth)
  const bookmark = (await page.getByRole('button', { name: 'Saved projects', exact: true }).boundingBox())!
  expect(bookmark.x + bookmark.width).toBeLessThanOrEqual(viewport)
  expect(issues).toEqual([])
})

test('overflow keeps active tabs and the new-session button reachable', async () => {
  for (let i = 0; i < 7; i += 1) await quickShell(`Long session ${i} with a descriptive title`)
  const strip = page.locator('.browser-tabs__scroll')
  await expect.poll(() => strip.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
  const selected = (await page.locator('.browser-tab--active').boundingBox())!
  const bounds = (await strip.boundingBox())!
  expect(selected.x).toBeGreaterThanOrEqual(bounds.x - 1)
  expect(selected.x + selected.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
  await expect(page.locator('.browser-tabs').getByRole('button', { name: 'New session', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'All tabs', exact: true }).click()
  await page.getByLabel('Search open tabs').fill('Long session 6')
  await expect(page.locator('.all-tab')).toHaveCount(1)
  await page.locator('.all-tab').click()
  await expect(page.locator('.browser-tab--active .browser-tab__title')).toHaveText('Long session 6 with a descriptive title')
})
