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
  defaultShellId: null,
  // The installer registers the Explorer verb, so the stored default has to
  // agree with it or the first settings write would silently remove it.
  explorerContextMenu: true,
  // migrateSettingsFile fills this in for a file written before it existed, so
  // no SETTINGS_SCHEMA_VERSION bump: the transform that would justify one is
  // already the one that runs on every load.
  gpuRendering: true
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

/**
 * Adds newly introduced settings without discarding a user's existing values.
 *
 * Fills the gaps on every load rather than only when `schemaVersion` is behind.
 * A version check alone is not enough because the stamp can lie: 0.1.0's schema
 * accepts `schemaVersion: 2`, strips the typography fields it does not know, and
 * rewrites the file still stamped 2. Coming back to a build that requires those
 * fields, such a file would skip migration, fail validation, and be moved aside
 * as corrupt — taking the user's theme, scrollback and shell choice with it.
 *
 * Existing values always win over the defaults, so this is safe to re-run and
 * never overwrites a real preference. A file whose values are genuinely invalid
 * still fails the schema and still gets the corrupt-file treatment.
 */
function migrateSettingsFile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const file = raw as Record<string, unknown>
  if (!file.settings || typeof file.settings !== 'object') return raw
  return {
    ...file,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, ...(file.settings as Record<string, unknown>) }
  }
}
