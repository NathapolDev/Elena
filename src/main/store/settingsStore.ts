/**
 * App-level settings, including the theme preference that must survive relaunch
 * (FR-26).
 */
import { join } from 'node:path'
import { app } from 'electron'
import { SETTINGS_SCHEMA_VERSION, settingsFileSchema } from '@shared/schemas'
import { DEFAULT_TERMINAL_FONT_SIZE, DEFAULT_TERMINAL_LINE_HEIGHT } from '@shared/terminalTypography'
import type { AppSettings } from '@shared/types'
import { loadJsonFile, writeJsonFileAtomic } from './atomicJson'
import { logger } from '../logger'

export const DEFAULT_SETTINGS: AppSettings = {
  themePreference: 'system',
  terminalFontFamily: null,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  terminalLineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
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
    const outcome = loadJsonFile<SettingsFile>(
      this.filePath,
      settingsFileSchema,
      () => ({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        settings: { ...DEFAULT_SETTINGS }
      }),
      migrateSettingsFile
    )
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

/** Adds newly introduced settings without discarding a user's existing values. */
function migrateSettingsFile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const file = raw as Record<string, unknown>
  if (!file.settings || typeof file.settings !== 'object') return raw
  if (typeof file.schemaVersion !== 'number' || file.schemaVersion < SETTINGS_SCHEMA_VERSION) {
    return {
      ...file,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, ...(file.settings as Record<string, unknown>) }
    }
  }
  return file
}
