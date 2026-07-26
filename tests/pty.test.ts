/**
 * PTY integration tests (Phase 2 exit criteria).
 *
 * These run against real child processes: create, write, resize, exit, restart
 * and — most importantly — that nothing survives `disposeAll` (NFR-08).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { PtyManager } from '../src/main/pty/PtyManager'
import type { SessionStatus, TerminalConfig } from '@shared/types'

const dir = mkdtempSync(join(tmpdir(), 'aiws-pty-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const isWindows = process.platform === 'win32'
const shell = isWindows ? 'cmd.exe' : 'sh'

function config(id: string, overrides: Partial<TerminalConfig> = {}): TerminalConfig {
  return {
    id,
    title: id,
    executable: shell,
    args: [],
    cwd: dir,
    envAllowlist: [],
    ...overrides
  }
}

type Harness = {
  manager: PtyManager
  output: () => string
  statuses: SessionStatus[]
  exits: Array<{ terminalId: string; exitCode?: number }>
}

function harness(): Harness {
  let buffer = ''
  const statuses: SessionStatus[] = []
  const exits: Array<{ terminalId: string; exitCode?: number }> = []
  const manager = new PtyManager({
    onData: (_id, chunk) => {
      buffer += chunk
    },
    onStatus: (_id, status) => statuses.push(status),
    onExit: (terminalId, exitCode) => exits.push({ terminalId, ...(exitCode === undefined ? {} : { exitCode }) })
  })
  return { manager, output: () => buffer, statuses, exits }
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function processExists(pid: number): boolean {
  try {
    if (isWindows) {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' })
      return out.includes(String(pid))
    }
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('PtyManager', () => {
  it('reports EXECUTABLE_NOT_FOUND instead of throwing', () => {
    const { manager } = harness()
    const result = manager.create(config('missing', { executable: 'definitely-not-real-xyz' }), 80, 24)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('EXECUTABLE_NOT_FOUND')
    manager.disposeAll()
  })

  it('reports INVALID_CWD for a directory that does not exist', () => {
    const { manager } = harness()
    const result = manager.create(config('bad-cwd', { cwd: join(dir, 'nope') }), 80, 24)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_CWD')
    manager.disposeAll()
  })

  it('spawns a shell, runs a command and streams the output', async () => {
    const { manager, output } = harness()
    const result = manager.create(config('echo'), 80, 24)
    expect(result.ok).toBe(true)

    manager.write('echo', 'echo PTY_MARKER_OK\r')
    await waitFor(() => output().includes('PTY_MARKER_OK'))
    expect(output()).toContain('PTY_MARKER_OK')

    manager.disposeAll()
  })

  it('is idempotent: creating an already-running id returns the same session', () => {
    const { manager } = harness()
    const first = manager.create(config('dup'), 80, 24)
    const second = manager.create(config('dup'), 100, 30)
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) expect(second.session.pid).toBe(first.session.pid)
    expect(manager.runningCount()).toBe(1)
    manager.disposeAll()
  })

  it('accepts a resize while running', async () => {
    const { manager } = harness()
    manager.create(config('resize'), 80, 24)
    expect(manager.resize('resize', 120, 40)).toBe(true)
    manager.disposeAll()
    await waitFor(() => manager.runningCount() === 0)
  })

  it('emits exit with a status change when the process ends on its own', async () => {
    const { manager, exits, statuses } = harness()
    manager.create(config('exiting'), 80, 24)
    manager.write('exiting', 'exit\r')

    await waitFor(() => exits.length > 0)
    expect(exits[0]?.terminalId).toBe('exiting')
    expect(statuses).toContain('exited')
    expect(manager.isRunning('exiting')).toBe(false)
    manager.disposeAll()
  })

  it('terminate stops a running session', async () => {
    const { manager, exits } = harness()
    const result = manager.create(config('terminate-me'), 80, 24)
    expect(result.ok).toBe(true)

    manager.terminate('terminate-me', { force: true })
    await waitFor(() => exits.length > 0)
    expect(manager.isRunning('terminate-me')).toBe(false)
    manager.disposeAll()
  })

  it('ignores a stale exit after replacing a terminal with the same id', async () => {
    const { manager, statuses, exits } = harness()
    const first = manager.create(config('restart-race'), 80, 24)
    expect(first.ok).toBe(true)

    manager.dispose('restart-race')
    const replacement = manager.create(config('restart-race'), 80, 24)
    expect(replacement.ok).toBe(true)

    statuses.length = 0
    exits.length = 0
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(manager.getSession('restart-race')?.status).toBe('running')
    expect(statuses).not.toContain('exited')
    expect(exits).toHaveLength(0)
    manager.disposeAll()
  })

  it('leaves no orphan process behind after disposeAll', async () => {
    const { manager } = harness()
    const pids: number[] = []
    for (const id of ['orphan-1', 'orphan-2', 'orphan-3']) {
      const result = manager.create(config(id), 80, 24)
      if (result.ok && result.session.pid) pids.push(result.session.pid)
    }
    expect(pids).toHaveLength(3)

    manager.disposeAll()
    expect(manager.listSessions()).toHaveLength(0)

    await waitFor(() => pids.every((pid) => !processExists(pid)), 20_000)
    for (const pid of pids) expect(processExists(pid)).toBe(false)
  })

  it('batches high-volume output without losing the tail', async () => {
    const { manager, output } = harness()
    manager.create(config('loud'), 120, 40)

    const command = isWindows
      ? 'for /L %i in (1,1,300) do @echo line-%i\r'
      : 'for i in $(seq 1 300); do echo line-$i; done\r'
    manager.write('loud', command)

    await waitFor(() => output().includes('line-300'), 20_000)
    expect(output()).toContain('line-300')
    manager.disposeAll()
  })

  it('handles 10 noisy sessions concurrently without blocking the event loop', async () => {
    const buffers = new Map<string, string>()
    const manager = new PtyManager({
      onData: (id, chunk) => buffers.set(id, `${buffers.get(id) ?? ''}${chunk}`),
      onStatus: () => {},
      onExit: () => {}
    })

    const ids = Array.from({ length: 10 }, (_, index) => `load-${index + 1}`)
    const pids: number[] = []
    for (const id of ids) {
      const result = manager.create(config(id), 120, 40)
      expect(result.ok).toBe(true)
      if (result.ok && result.session.pid) pids.push(result.session.pid)
    }
    // NFR-03 concerns simultaneous output after sessions exist; ConPTY spawn
    // cost is intentionally outside this event-loop measurement.
    let maxTimerGap = 0
    let previousTick = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      maxTimerGap = Math.max(maxTimerGap, now - previousTick)
      previousTick = now
    }, 20)
    for (const id of ids) {
      const command = isWindows
        ? `for /L %i in (1,1,300) do @echo ${id}-%i\r`
        : `for i in $(seq 1 300); do echo ${id}-$i; done\r`
      manager.write(id, command)
    }

    await waitFor(() => ids.every((id) => buffers.get(id)?.includes(`${id}-300`) === true), 25_000)
    clearInterval(timer)
    expect(maxTimerGap).toBeLessThan(200)
    expect(manager.runningCount()).toBe(10)
    manager.disposeAll()
    await waitFor(() => manager.runningCount() === 0)
    await waitFor(() => pids.every((pid) => !processExists(pid)), 20_000)
  })
})
