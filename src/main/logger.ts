/**
 * Rotating application log.
 *
 * NFR-09: application events and error metadata only. Terminal input/output and
 * environment values must never reach this file, so nothing here accepts a raw
 * PTY chunk — callers pass structured metadata and it is size-capped.
 */
import { app } from 'electron'
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { WriteStream } from 'node:fs'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_FILES = 3
const MAX_FIELD_LENGTH = 500
const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key)/i

type Level = 'info' | 'warn' | 'error'

let stream: WriteStream | null = null
let logPath = ''

function ensureStream(): WriteStream | null {
  if (stream) return stream
  try {
    const dir = join(app.getPath('userData'), 'logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'app.log')
    stream = createWriteStream(logPath, { flags: 'a' })
    return stream
  } catch {
    return null
  }
}

function rotateIfNeeded(): void {
  if (!logPath || !existsSync(logPath)) return
  try {
    if (statSync(logPath).size < MAX_BYTES) return
    stream?.end()
    stream = null
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const from = `${logPath}.${i}`
      const to = `${logPath}.${i + 1}`
      if (existsSync(from)) {
        if (existsSync(to)) unlinkSync(to)
        renameSync(from, to)
      }
    }
    renameSync(logPath, `${logPath}.1`)
  } catch {
    /* logging must never break the app */
  }
}

/** Truncates and strips newlines so one field cannot smuggle a whole terminal buffer in. */
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    const flat = value
      .replace(/[\r\n]+/g, ' ')
      .replace(/\bBearer\s+[^\s]+/gi, `Bearer ${REDACTED}`)
      .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g, REDACTED)
      .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=([^\s]+)/gi, `$1=${REDACTED}`)
    return flat.length > MAX_FIELD_LENGTH ? `${flat.slice(0, MAX_FIELD_LENGTH)}…` : flat
  }
  if (value instanceof Error) return sanitize(value.message)
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : sanitize(v)
    }
    return out
  }
  return value
}

export function sanitizeLogMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return sanitize(meta) as Record<string, unknown>
}

function write(level: Level, event: string, meta?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(meta ? sanitizeLogMeta(meta) : {})
  })
  if (!app.isPackaged) {
    if (level === 'error') console.error(line)
    else console.log(line)
  }
  rotateIfNeeded()
  ensureStream()?.write(`${line}\n`)
}

export const logger = {
  info: (event: string, meta?: Record<string, unknown>) => write('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => write('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => write('error', event, meta),
  close: () => {
    stream?.end()
    stream = null
  }
}
