/**
 * Seeds an E2E user-data directory before the app first reads it.
 *
 * Only one setting needs this today: `gpuRendering`. With the GPU renderer on,
 * xterm draws to a canvas and the terminal text is not in the DOM at all, so
 * every assertion in this suite that reads what a session printed would have
 * nothing to read. Turning it off here is the same switch a user has in
 * Settings, which is why this seeds a real settings file rather than adding a
 * test-only branch to the app.
 *
 * A partial `settings` object is deliberate: `migrateSettingsFile` fills every
 * missing field from the defaults on load, so this file stays valid as settings
 * are added.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_SCHEMA_VERSION } from '../src/shared/schemas'

export function seedE2eSettings(userDataDir: string): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, settings: { gpuRendering: false } }),
    'utf8'
  )
}
