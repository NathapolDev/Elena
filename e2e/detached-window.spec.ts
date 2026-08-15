/**
 * NFR-08 across the multi-window path.
 *
 * Detaching a terminal moves UI only, so the risk this guards is a child that
 * outlives the app because a second window confused the shutdown order. The
 * positive control matters: the test asserts a shell really spawned before it
 * asserts none survived, otherwise it would pass on an app that never started
 * anything.
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

function shellPids(): Set<number> {
  const out = execSync(
    'powershell -NoProfile -Command "Get-Process pwsh,powershell -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"',
    { encoding: 'utf8' }
  )
  return new Set(
    out
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
  )
}

test('a write from one window does not delete a terminal the other created', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'elena-xwin-project-'))
  const userData = mkdtempSync(join(tmpdir(), 'elena-xwin-userdata-'))
  writeFileSync(join(projectRoot, 'MARKER.txt'), 'x')

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, ELENA_E2E: '1' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Cross Window')
  await page.getByLabel('Project root').fill(projectRoot)
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Open terminal' }).click()
  await expect(page.locator('.session-item')).toHaveCount(1)

  await page.locator('.pane').first().getByRole('button', { name: 'Open in new window' }).click()
  await expect.poll(() => app.windows().length).toBe(2)
  const detachedPage = app.windows().find((w) => w !== page)!
  await detachedPage.waitForLoadState('domcontentloaded')
  // Wait for its bootstrap to finish before moving on: the pane only renders
  // once `workspace:list` has resolved. Without this the window can load its
  // list *after* the next step and the stale-copy race never happens.
  await expect(detachedPage.locator('.pane__title')).toBeVisible()

  // The main window creates a terminal the detached window has never seen.
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Open terminal' }).click()
  await expect(page.locator('.session-item')).toHaveCount(2)

  // Now the detached window writes. Patches carry the whole `terminals` array,
  // so a stale copy here silently drops the terminal made above.
  await detachedPage.locator('.pane__title').dblclick()
  await detachedPage.getByLabel('Terminal name').fill('Renamed In Detached')
  await detachedPage.getByRole('button', { name: 'Save name' }).click()
  await expect(detachedPage.locator('.pane__title')).toHaveText('Renamed In Detached')

  // Assert against disk, not against either window's local copy: the window
  // that did not write still shows the terminal it remembers either way.
  await app.close()
  const persisted = JSON.parse(readFileSync(join(userData, 'workspaces.json'), 'utf8')) as {
    workspaces: { terminals: { title: string }[] }[]
  }
  expect(persisted.workspaces[0]!.terminals).toHaveLength(2)

  const relaunched = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, ELENA_E2E: '1' }
  })
  const relaunchedPage = await relaunched.firstWindow()
  await relaunchedPage.waitForLoadState('domcontentloaded')
  await expect(relaunchedPage.locator('.session-item')).toHaveCount(2)
  await expect(relaunchedPage.locator('.session-item__title').first()).toHaveText('Renamed In Detached')

  await relaunched.close()
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('quitting with a detached window open leaves no orphan shell', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'elena-orphan-project-'))
  const userData = mkdtempSync(join(tmpdir(), 'elena-orphan-userdata-'))
  writeFileSync(join(projectRoot, 'MARKER.txt'), 'x')

  const before = shellPids()

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, ELENA_E2E: '1' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await page.getByRole('button', { name: 'Create Workspace' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Orphan Check')
  await page.getByLabel('Project root').fill(projectRoot)
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Open terminal' }).click()
  await expect(page.locator('.pane').getByText(/Running/)).toBeVisible()

  // A shell really is running now, or the rest of this proves nothing.
  const during = shellPids()
  const spawned = [...during].filter((id) => !before.has(id))
  expect(spawned.length).toBeGreaterThan(0)

  await page.locator('.pane').first().getByRole('button', { name: 'Open in new window' }).click()
  await expect.poll(() => app.windows().length).toBe(2)

  await app.close()

  await expect
    .poll(
      () => {
        const after = shellPids()
        return spawned.filter((id) => after.has(id)).length
      },
      { timeout: 15_000 }
    )
    .toBe(0)

  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})
