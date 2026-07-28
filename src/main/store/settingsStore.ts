/**
 * App-level settings, including the theme preference that must survive relaunch
 * (FR-26).
 */
import { join } from 'node:path'
import { app } from 'electron'
import { SETTINGS_SCHEMA_VERSION, settingsFileSchema } from '@shared/schemas'
import type { AppSettings } from '@shared/types'
import { loadJsonFile, writeJsonFileAtomic } from './atomicJson'
import { logger } from '../logger'

export const DEFAULT_SETTINGS: AppSettings = {
  themePreference: 'system',
  scrollback: 10_000, // NFR-04
  confirmCloseRunning: true,
  warnOnMultilinePaste: true, // NFR-14
  defaultShellId: null
}

type SettingsFile = { schemaVersion: number; settings: AppSettings }

export class SettingsStore {
  private file: SettingsFile = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS }
  }

  constructor(private readonly filePath = join(app.getPath('userData'), 'settings.json')) {}

  load(): void {
    const outcome = loadJsonFile<SettingsFile>(this.filePath, settingsFileSchema, () => ({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS }
    }))
    this.file = outcome.data
    logger.info('settings.loaded', { recovered: Boolean(outcome.recoveredFrom) })
  }

  get(): AppSettings {
    return { ...this.file.settings }
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next: SettingsFile = {
      ...this.file,
      settings: { ...this.file.settings, ...patch }
    }
    try {
      writeJsonFileAtomic(this.filePath, next)
    } catch (error) {
      logger.error('settings.save-failed', { error })
      throw error
    }
    this.file = next
    return this.get()
  }
}
