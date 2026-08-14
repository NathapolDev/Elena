/**
 * Shared stdin reader for the hook scripts.
 *
 * Claude Code hands each hook its event as JSON on stdin. A hook that cannot
 * parse it must not block the turn, so every failure degrades to `null` and the
 * caller exits 0.
 */
import { readFileSync } from 'node:fs'

export function readHookPayload() {
  try {
    const raw = readFileSync(0, 'utf8')
    return raw.trim() ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
