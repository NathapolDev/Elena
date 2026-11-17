import { _electron as electron, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

export function launchTestApp(userData: string): Promise<ElectronApplication> {
  const executablePath = process.env.ELENA_E2E_EXECUTABLE
  return electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${userData}`],
    cwd: process.cwd(), env: { ...process.env, ELENA_E2E: '1' } })
}

export async function openProjectActions(page: Page): Promise<void> {
  await page.locator('.project-group--active .project-group__label, .project-group__label').first().click({ button: 'right' })
  await expect(page.locator('.chrome-popover[role="dialog"]')).toBeVisible()
}

export async function openSessionActions(page: Page): Promise<void> {
  await page.locator('.browser-tab--active [role="tab"], .browser-tab [role="tab"]').first().click({ button: 'right' })
  await expect(page.locator('.chrome-popover[role="dialog"]')).toBeVisible()
}

export async function openActions(page: Page): Promise<void> {
  await openSessionActions(page)
}

export async function action(page: Page, name: string): Promise<void> {
  const projectActions = ['Rename project', 'Close project', 'Focus project', 'About Elena', 'Settings']
  if (projectActions.includes(name)) {
    await openProjectActions(page)
  } else {
    await openSessionActions(page)
  }
  await page.locator('.chrome-popover[role="dialog"]').getByRole('button', { name, exact: true }).click()
}

export async function configureSession(page: Page): Promise<void> {
  await page.locator('.browser-tabs').getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByRole('button', { name: 'Configure…', exact: false }).click()
  await expect(page.getByLabel('Shell or agent')).toBeVisible()
}

export async function renameSession(page: Page, name: string): Promise<void> {
  await page.keyboard.press('F2')
  await page.getByLabel('Terminal name').fill(name)
  await page.getByRole('button', { name: 'Save name' }).click()
}

export async function newProject(page: Page, name: string, root: string): Promise<void> {
  await expect(page.locator('.empty-state__title, .project-group__label').first()).toBeVisible()
  await page.keyboard.press('Control+Shift+KeyN')
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByLabel('Project root').fill(root)
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
}

export async function savedProject(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Control+KeyB')
  await page.getByRole('button', { name: `Open project ${name}`, exact: true }).click()
}
