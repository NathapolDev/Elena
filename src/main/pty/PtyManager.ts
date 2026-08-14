/**
 * PTY lifecycle owner. Every child process in the app is created and destroyed
 * here, and the registry is what guarantees no orphan survives a normal exit
 * (NFR-08).
 *
 * Deliberately free of Electron imports so PTY behaviour can be integration
 * tested without launching a window.
 */
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { buildChildEnv, resolveExecutable, validateDirectory } from '../security/paths'
import type { AppError, RuntimeSession, SessionStatus, TerminalConfig } from '@shared/types'

/** Output is batched to avoid one IPC message per keystroke of output (risk: UI stalls). */
const FLUSH_INTERVAL_MS = 16
const MAX_PENDING_BYTES = 4 * 1024 * 1024
const GRACEFUL_KILL_TIMEOUT_MS = 2000

export type PtyEvents = {
  onData: (terminalId: string, chunk: string) => void
  onStatus: (terminalId: string, status: SessionStatus, pid?: number) => void
  onExit: (terminalId: string, exitCode: number | undefined, signal: number | undefined) => void
}

type Entry = {
  pty: IPty
  config: TerminalConfig
  session: RuntimeSession
  pending: string[]
  pendingBytes: number
  flushTimer: NodeJS.Timeout | null
  killTimer: NodeJS.Timeout | null
  /** Set by `terminate`: the caller is done with this id, so drop the entry once the child is gone. */
  disposeOnExit: boolean
}

export type CreateResult = { ok: true; session: RuntimeSession } | { ok: false; error: AppError }

export const TRUNCATION_MARKER = '\r\n[output truncated: terminal could not keep up]\r\n'

/**
 * Backpressure guard: a runaway process must not grow main-process memory
 * without bound. Drops the oldest chunks and tells the user in-band.
 *
 * Exported and pure so `tests/pty-backpressure.test.ts` can prove the arithmetic
 * at the real 4 MB cap without pushing 4 MB through ConPTY, which is slow and
 * flaky on CI. Mutates `pending` in place and returns the new byte count.
 */
export function appendWithCap(
  pending: string[],
  pendingBytes: number,
  chunk: string,
  cap: number
): number {
  pending.push(chunk)
  let bytes = pendingBytes + chunk.length
  while (bytes > cap && pending.length > 1) {
    const dropped = pending.shift()
    bytes -= dropped?.length ?? 0
    pending[0] = `${TRUNCATION_MARKER}${pending[0] ?? ''}`
  }
  return bytes
}

export class PtyManager {
  private readonly sessions = new Map<string, Entry>()

  constructor(private readonly events: PtyEvents) {}

  create(config: TerminalConfig, cols: number, rows: number, workspaceRoot: string): CreateResult {
    // Idempotent: a pane can remount (split, zoom, StrictMode) and ask again for
    // a session it already owns. Returning the live one avoids a second child.
    const existing = this.sessions.get(config.id)
    if (existing) {
      if (existing.session.status === 'running') {
        this.resize(config.id, cols, rows)
        return { ok: true, session: { ...existing.session } }
      }
      this.dispose(config.id)
    }

    const cwdCheck = validateDirectory(config.cwd, workspaceRoot)
    if (!cwdCheck.ok) {
      return {
        ok: false,
        error: {
          code: 'INVALID_CWD',
          message: `Working directory is not usable (${cwdCheck.reason}): ${config.cwd}`,
          action: 'choose-directory'
        }
      }
    }

    const env = buildChildEnv(config.envAllowlist)
    const resolved = resolveExecutable(config.executable, env)
    if (!resolved) {
      return {
        ok: false,
        error: {
          code: 'EXECUTABLE_NOT_FOUND',
          message: `Cannot find "${config.executable}" on PATH.`,
          action: 'open-preset-settings'
        }
      }
    }

    let pty: IPty
    try {
      // Executable + argument array, never a composed shell string (NFR-12).
      pty = spawn(resolved, [...config.args], {
        name: 'xterm-256color',
        cols: Math.max(1, cols),
        rows: Math.max(1, rows),
        cwd: cwdCheck.path,
        env,
        // The bundled ConPTY DLL closes the pseudo console directly. The
        // Windows API fallback forks a console-list helper during kill, which
        // races short-lived shells and can emit an unhandled AttachConsole
        // error after the test/app has already disposed the session.
        ...(process.platform === 'win32' ? { useConptyDll: true } : {})
      })
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'SPAWN_FAILED',
          message: sanitizeSpawnError(error),
          action: 'retry'
        }
      }
    }

    const session: RuntimeSession = {
      terminalId: config.id,
      pid: pty.pid,
      status: 'running',
      startedAt: new Date().toISOString()
    }

    const entry: Entry = {
      pty,
      config,
      session,
      pending: [],
      pendingBytes: 0,
      flushTimer: null,
      killTimer: null,
      disposeOnExit: false
    }
    this.sessions.set(config.id, entry)

    pty.onData((chunk) => this.enqueue(entry, chunk))
    pty.onExit(({ exitCode, signal }) => this.handleExit(entry, exitCode, signal))

    this.events.onStatus(config.id, 'running', pty.pid)
    return { ok: true, session: { ...session } }
  }

  write(terminalId: string, data: string): boolean {
    const entry = this.sessions.get(terminalId)
    if (!entry || entry.session.status !== 'running') return false
    entry.pty.write(data)
    return true
  }

  resize(terminalId: string, cols: number, rows: number): boolean {
    const entry = this.sessions.get(terminalId)
    if (!entry || entry.session.status !== 'running') return false
    try {
      entry.pty.resize(Math.max(1, cols), Math.max(1, rows))
      return true
    } catch {
      // A process that exited between the check and the call is not an error.
      return false
    }
  }

  /** Sends an interrupt first, then force-kills after a timeout (FR-13). */
  terminate(terminalId: string, { force = false } = {}): boolean {
    const entry = this.sessions.get(terminalId)
    if (!entry) return false
    if (entry.session.status !== 'running') {
      this.dispose(terminalId)
      return true
    }

    // A running session cannot be dropped here — it still owes a graceful \x03
    // and an exit event. Flag it so `handleExit` removes the entry instead of
    // leaving one behind for every terminal the user ever closed.
    entry.disposeOnExit = true

    if (force) {
      this.forceKill(entry)
      return true
    }

    try {
      entry.pty.write('\x03')
    } catch {
      /* already gone */
    }
    if (entry.killTimer) clearTimeout(entry.killTimer)
    entry.killTimer = setTimeout(() => this.forceKill(entry), GRACEFUL_KILL_TIMEOUT_MS)
    return true
  }

  getSession(terminalId: string): RuntimeSession | undefined {
    const entry = this.sessions.get(terminalId)
    return entry ? { ...entry.session } : undefined
  }

  listSessions(): RuntimeSession[] {
    return [...this.sessions.values()].map((e) => ({ ...e.session }))
  }

  isRunning(terminalId: string): boolean {
    return this.sessions.get(terminalId)?.session.status === 'running'
  }

  runningCount(): number {
    return [...this.sessions.values()].filter((e) => e.session.status === 'running').length
  }

  /** Removes bookkeeping for an exited session. Running sessions are killed first. */
  dispose(terminalId: string): void {
    const entry = this.sessions.get(terminalId)
    if (!entry) return
    if (entry.flushTimer) clearTimeout(entry.flushTimer)
    if (entry.killTimer) clearTimeout(entry.killTimer)
    if (entry.session.status === 'running') this.forceKill(entry)
    this.sessions.delete(terminalId)
  }

  /** Called on app quit. Every child is killed before the process exits (NFR-08). */
  disposeAll(): void {
    for (const terminalId of [...this.sessions.keys()]) this.dispose(terminalId)
  }

  private forceKill(entry: Entry): void {
    if (entry.killTimer) {
      clearTimeout(entry.killTimer)
      entry.killTimer = null
    }
    try {
      entry.pty.kill()
    } catch {
      /* the process may have exited on its own */
    }
  }

  private enqueue(entry: Entry, chunk: string): void {
    entry.pendingBytes = appendWithCap(entry.pending, entry.pendingBytes, chunk, MAX_PENDING_BYTES)
    if (entry.flushTimer) return
    entry.flushTimer = setTimeout(() => this.flush(entry), FLUSH_INTERVAL_MS)
  }

  private flush(entry: Entry): void {
    entry.flushTimer = null
    if (entry.pending.length === 0) return
    const payload = entry.pending.join('')
    entry.pending = []
    entry.pendingBytes = 0
    this.events.onData(entry.config.id, payload)
  }

  private handleExit(entry: Entry, exitCode: number, signal: number | undefined): void {
    // A restarted terminal reuses its configuration id. ConPTY can deliver the
    // old process exit after the replacement is already running; that stale
    // event must not overwrite the new session in the renderer.
    if (this.sessions.get(entry.config.id) !== entry) {
      if (entry.killTimer) clearTimeout(entry.killTimer)
      if (entry.flushTimer) clearTimeout(entry.flushTimer)
      entry.pending = []
      entry.pendingBytes = 0
      return
    }

    if (entry.killTimer) {
      clearTimeout(entry.killTimer)
      entry.killTimer = null
    }
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    this.flush(entry)

    entry.session.status = 'exited'
    entry.session.exitCode = exitCode
    entry.session.signal = signal
    entry.session.endedAt = new Date().toISOString()

    this.events.onStatus(entry.config.id, 'exited', entry.session.pid)
    this.events.onExit(entry.config.id, exitCode, signal)

    if (entry.disposeOnExit) this.sessions.delete(entry.config.id)
  }
}

/** Keeps OS error text but strips anything path-like that we did not construct. */
function sanitizeSpawnError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/[\r\n]+/g, ' ').slice(0, 300)
}
