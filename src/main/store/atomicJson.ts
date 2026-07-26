/**
 * Versioned JSON persistence with atomic writes.
 *
 * FR-03: write to a temp file then rename, so a crash mid-write can never leave
 * a half-written file in place.
 * FR-04: an unreadable or schema-invalid file is moved aside as a backup and the
 * caller falls back to defaults instead of the app refusing to start.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { z } from 'zod'
import { logger } from '../logger'

export type LoadOutcome<T> = {
  data: T
  /** Path of the backup written when the existing file could not be used. */
  recoveredFrom?: string
}

export function loadJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  fallback: () => T,
  migrate?: (raw: unknown) => unknown
): LoadOutcome<T> {
  if (!existsSync(filePath)) return { data: fallback() }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    return { data: fallback(), recoveredFrom: backupCorruptFile(filePath, 'parse-failed', error) }
  }

  const migrated = migrate ? migrate(raw) : raw
  const parsed = schema.safeParse(migrated)
  if (!parsed.success) {
    return {
      data: fallback(),
      recoveredFrom: backupCorruptFile(filePath, 'schema-invalid', parsed.error.issues[0]?.message)
    }
  }
  return { data: parsed.data }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const tmp = join(dir, `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`)
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, filePath)
  } catch (error) {
    // Leave the last known-good file untouched (error handling rules:
    // "retry without overwriting the most recent good file").
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
    throw error
  }
}

function backupCorruptFile(filePath: string, reason: string, detail?: unknown): string {
  const backupPath = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
  try {
    renameSync(filePath, backupPath)
  } catch {
    return ''
  }
  logger.warn('store.file-recovered', { filePath, backupPath, reason, detail })
  return backupPath
}
