/**
 * Workspace search, Quick Session, and pane rearrangement.
 *
 * These are the guarantees only a real window can show: that a session starts
 * with no workspace prepared, that the scratch workspace is never duplicated,
 * and that a drag actually rewrites the layout tree the way `moveTerminal`
 * says it does. The tree operations themselves are unit-tested in
 * `tests/layout.test.ts`; this covers the wiring around them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
let projectRoot: string
let userData: string

test.describe.configure({ mode: 'serial' })

/**
 * Real mouse input, not Playwright's `dragTo`. `dragTo` synthesises the drag
 * events directly, so it passes even when the element a user would actually
 * grab is not a drag handle at all — which is exactly how a broken affordance
 * shipped once already.
 */
async function realDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10)
    await page.waitForTimeout(25)
  }
  await page.waitForTimeout(150)
  await page.mouse.up()
}

test.beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'elena-v-project-'))
  userData = mkdtempSync(join(tmpdir(), 'elena-v-userdata-'))
  writeFileSync(join(projectRoot, 'MARKER.txt'), 'x')
  mkdirSync(join(projectRoot, 'preset-cwd'))
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, ELENA_E2E: '1' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('quick session starts an agent with no workspace prepared', async () => {
  await expect(page.getByText('No workspace yet')).toBeVisible()
  // The empty state offers one button per preset that has an executable.
  const quick = page.locator('.empty-state__actions button').nth(1)
  await expect(quick).toBeVisible()
  const label = await quick.innerText()
  await quick.click()

  // A scratch workspace appears and a session is configured in it.
  await expect(page.locator('.commandbar__title')).toHaveText('Quick Session')
  await expect(page.locator('.pane')).toHaveCount(1)
  await expect(page.locator('.pane__title')).toHaveText(label.trim())

  // Pressing it again must reuse the same workspace, not make a second one.
  await page.getByRole('button', { name: 'New Terminal' }).first().click()
  await page.getByRole('button', { name: 'Open terminal' }).click()
  await expect(page.locator('.workspace-item')).toHaveCount(1)
  await expect(page.locator('.pane')).toHaveCount(2)
})

test('workspace search filters the rail', async () => {
  await page.getByRole('button', { name: 'New workspace' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Zebra Project')
  await page.getByLabel('Project root').fill(projectRoot)
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click()
  await expect(page.locator('.workspace-item')).toHaveCount(2)

  await page.keyboard.press('Control+Shift+KeyF')
  await expect(page.locator('#workspace-search')).toBeFocused()
  await page.keyboard.type('zeb')
  await expect(page.locator('.workspace-item')).toHaveCount(1)
  await expect(page.locator('.sidebar__search-count')).toHaveText('1 of 2 workspaces')

  await page.keyboard.press('Escape')
  await expect(page.locator('.workspace-item')).toHaveCount(2)
})

test('dragging a pane onto another rearranges the layout', async () => {
  await page.locator('.workspace-item').first().click()
  await expect(page.locator('.pane')).toHaveCount(2)

  const titlesBefore = await page.locator('.pane__title').allInnerTexts()
  expect(titlesBefore[0]).not.toBe(titlesBefore[1]) // otherwise a swap is unobservable
  await expect(page.locator('.split--horizontal')).toHaveCount(1)

  // Grab the metadata strip rather than the title: real users aim at the header
  // bar generally, and `dragTo` would pass even if only the title were a handle.
  const grab = (await page.locator('.pane').nth(1).locator('.pane__metadata').boundingBox())!
  const target = (await page.locator('.pane').nth(0).boundingBox())!

  // Centre of the target is the swap zone: the two panes trade places and the
  // surrounding structure is untouched.
  await realDrag(
    page,
    { x: grab.x + grab.width / 2, y: grab.y + grab.height / 2 },
    { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  )
  await expect
    .poll(async () => (await page.locator('.pane__title').allInnerTexts()).join('|'))
    .toBe([...titlesBefore].reverse().join('|'))
  await expect(page.locator('.split--horizontal')).toHaveCount(1)
  await expect(page.locator('.split--vertical')).toHaveCount(0)

  // An edge drop is a different operation: it re-splits along the other axis.
  const grab2 = (await page.locator('.pane').nth(1).locator('.pane__metadata').boundingBox())!
  const target2 = (await page.locator('.pane').nth(0).boundingBox())!
  await realDrag(
    page,
    { x: grab2.x + grab2.width / 2, y: grab2.y + grab2.height / 2 },
    { x: target2.x + target2.width / 2, y: target2.y + 12 }
  )
  await expect(page.locator('.split--vertical')).toHaveCount(1)
  await expect(page.locator('.pane')).toHaveCount(2)
  await expect
    .poll(async () => (await page.locator('.pane__title').allInnerTexts()).join('|'))
    .toBe(titlesBefore.join('|'))
})

test('the pane action buttons still click rather than starting a drag', async () => {
  // The header is draggable; `draggable={false}` on the actions is what keeps
  // a press on a button from being swallowed by a drag session.
  await page.locator('.pane').first().getByRole('button', { name: 'Zoom pane' }).click()
  await expect(page.locator('.pane')).toHaveCount(1)
  await page.locator('.pane').first().getByRole('button', { name: 'Zoom pane' }).click()
  await expect(page.locator('.pane')).toHaveCount(2)
})

test('a narrow pane folds its icon row into one menu instead of overlapping', async () => {
  const wide = page.locator('.pane').first()
  // Wide: the detach action is a first-class icon and search is not an icon.
  await expect(wide.getByRole('button', { name: 'Open in new window' })).toBeVisible()
  await expect(wide.getByRole('button', { name: 'Find in terminal' })).toHaveCount(0)

  // Panes may be stacked vertically here, in which case each is still full
  // width — shrink the window itself rather than assuming a side-by-side split.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setMinimumSize(320, 240)
    window?.setContentSize(560, 640)
  })

  const pane = page.locator('.pane').first()
  // Assert the precondition, so a layout change gives a clear failure rather
  // than a confusing one about a missing class.
  await expect.poll(async () => Math.round((await pane.boundingBox())!.width)).toBeLessThan(420)
  await expect(pane).toHaveClass(/pane--compact/)
  // One button only: the hamburger. This is the regression that mattered —
  // five icons in a narrow header landed on top of the status badge.
  await expect(pane.locator('.pane__actions button')).toHaveCount(1)

  const identity = (await pane.locator('.pane__identity').boundingBox())!
  const actions = (await pane.locator('.pane__actions').boundingBox())!
  expect(identity.x + identity.width).toBeLessThanOrEqual(actions.x + 1)

  // Nothing became unreachable: every action moved into the menu.
  await pane.getByRole('button', { name: 'Session menu' }).click()
  for (const item of ['Open in new window', 'Restart', 'Stop', 'Zoom pane', 'Rename', 'Find in terminal', 'Close']) {
    await expect(page.getByRole('menuitem', { name: item, exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')

  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setContentSize(1440, 1024)
    window?.setMinimumSize(1180, 720)
  })
  await expect(page.locator('.pane').first()).not.toHaveClass(/pane--compact/)
})

test('Ctrl+Alt+Arrow swaps panes from the keyboard', async () => {
  const before = await page.locator('.pane__title').allInnerTexts()
  await page.locator('.pane').first().click()
  await page.keyboard.press('Control+Alt+ArrowRight')
  await expect
    .poll(async () => (await page.locator('.pane__title').allInnerTexts()).join('|'))
    .toBe([...before].reverse().join('|'))
})

test('quick session from the palette reuses the scratch workspace', async () => {
  const workspacesBefore = await page.locator('.workspace-item').count()
  const panesBefore = await page.locator('.pane').count()

  await page.keyboard.press('Control+KeyK')
  await expect(page.locator('.palette__input')).toBeVisible()
  await page.locator('.palette__input').fill('Quick session')
  await page.keyboard.press('Enter')

  await expect(page.locator('.commandbar__title')).toHaveText('Quick Session')
  await expect(page.locator('.pane')).toHaveCount(panesBefore + 1)
  // The whole point of the fixed id: no second scratch workspace appears.
  await expect(page.locator('.workspace-item')).toHaveCount(workspacesBefore)
})

test('the search shortcut does not steal focus out of an open dialog', async () => {
  await page.getByRole('button', { name: 'New workspace' }).click()
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible()

  await page.keyboard.press('Control+Shift+KeyF')

  // The dialog is dismissed rather than left open behind a focused input.
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0)
  await expect(page.locator('#workspace-search')).toBeFocused()
})

test('detaching opens a real second window and reattaching restores the pane', async () => {
  const detachedTitle = (await page.locator('.pane__title').allInnerTexts())[0]!
  const paneCount = await page.locator('.pane').count()

  await page.locator('.pane').first().getByRole('button', { name: 'Open in new window' }).click()

  await expect.poll(() => app.windows().length).toBe(2)
  const detachedPage = app.windows().find((w) => w !== page)!
  await detachedPage.waitForLoadState('domcontentloaded')

  // The new window renders exactly that one terminal, with the seam notice.
  await expect(detachedPage.locator('.pane')).toHaveCount(1)
  await expect(detachedPage.locator('.pane__title')).toHaveText(detachedTitle)
  await expect(detachedPage.locator('.detached-notice')).toBeVisible()
  await expect(detachedPage.locator('.sidebar')).toHaveCount(0)

  // Visibility is not enough: the window has no command bar, so the pane must
  // fill it. A missing `.app--detached` row rule left the terminal ~5px tall
  // while every `toBeVisible` assertion still passed.
  const paneBox = (await detachedPage.locator('.pane').boundingBox())!
  const innerHeight = await detachedPage.evaluate(() => window.innerHeight)
  expect(paneBox.height).toBeGreaterThan(innerHeight * 0.6)

  // The main window keeps the slot and offers it back.
  await expect(page.locator('.pane--detached')).toHaveCount(1)
  // The slot is kept, not removed: the total is unchanged.
  await expect(page.locator('.pane')).toHaveCount(paneCount)

  // The PTY never moved: it is still running on both sides of the handover.
  await expect(detachedPage.locator('.pane').getByText(/Running/)).toBeVisible()

  await page.getByRole('button', { name: 'Bring back' }).click()
  await expect.poll(() => app.windows().length).toBe(1)
  await expect(page.locator('.pane--detached')).toHaveCount(0)
  await expect(page.locator('.pane')).toHaveCount(paneCount)
  // Reattaching is exact: the terminal is back in the slot it left.
  await expect(page.locator('.pane__title').first()).toHaveText(detachedTitle)
})

test('closing a detached window reattaches instead of stranding it', async () => {
  const paneCount = await page.locator('.pane').count()
  await page.locator('.pane').first().getByRole('button', { name: 'Open in new window' }).click()
  await expect.poll(() => app.windows().length).toBe(2)

  const detachedPage = app.windows().find((w) => w !== page)!
  await detachedPage.close()

  await expect.poll(() => app.windows().length).toBe(1)
  await expect(page.locator('.pane--detached')).toHaveCount(0)
  await expect(page.locator('.pane')).toHaveCount(paneCount)
})

test('detached placement is not persisted across a relaunch', async () => {
  await page.locator('.pane').first().getByRole('button', { name: 'Open in new window' }).click()
  await expect.poll(() => app.windows().length).toBe(2)

  await app.close()
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: process.cwd(),
    env: { ...process.env, ELENA_E2E: '1' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  expect(app.windows().length).toBe(1)
  await expect(page.locator('.pane--detached')).toHaveCount(0)
})
