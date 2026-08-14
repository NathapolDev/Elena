/**
 * Stop hook: refuse to end a turn on a red tree.
 *
 * Runs the same two commands CI runs (`typecheck`, then `vitest`), and hands the
 * failure output back to Claude so it is fixed in-session instead of at push
 * time. A blocked Stop means the tree is red — not that the gate is wrong.
 *
 * Three cheap escapes keep it from being annoying:
 *   1. `stop_hook_active` — never re-gate a turn the gate itself provoked.
 *   2. no dirty files under src/tests/e2e — a docs-only or question-only turn
 *      has nothing to verify.
 *   3. the same dirty state already passed — re-running a green suite proves
 *      nothing.
 *
 * TUNING: measured at ~19 s on the dev machine (typecheck ~7 s, vitest ~12 s).
 * If it grows past ~45 s the turn will start to feel slow.
 * The first thing to drop is the real-PTY suite, which is the slow part and is
 * covered by CI anyway:
 *   ['vitest', 'run', '--exclude', 'tests/pty.test.ts', '--reporter=dot']
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readHookPayload } from './_payload.mjs'

const MARKER = join(process.cwd(), '.claude/hooks/.last-gate')
const MAX_REASON_LINES = 40

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', shell: true })
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }))
  process.exit(0)
}

const payload = readHookPayload()
if (payload?.stop_hook_active) process.exit(0)

const status = run('git', ['status', '--porcelain', '--', 'src', 'tests', 'e2e'])
const dirty = (status.stdout ?? '').trim()
if (!dirty) process.exit(0)

const fingerprint = createHash('sha256').update(dirty).digest('hex')
try {
  if (readFileSync(MARKER, 'utf8').trim() === fingerprint) process.exit(0)
} catch {
  /* no marker yet */
}

const typecheck = run('npm', ['run', 'typecheck'])
if (typecheck.status !== 0) {
  const output = `${typecheck.stdout ?? ''}${typecheck.stderr ?? ''}`.trim().split('\n')
  block(`\`npm run typecheck\` failed:\n\n${output.slice(-MAX_REASON_LINES).join('\n')}`)
}

const tests = run('npx', ['vitest', 'run', '--reporter=dot'])
if (tests.status !== 0) {
  const output = `${tests.stdout ?? ''}${tests.stderr ?? ''}`.trim().split('\n')
  block(
    'The test suite is red:\n\n' +
      `${output.slice(-MAX_REASON_LINES).join('\n')}\n\n` +
      'If a guard suite failed, it encodes a contract — fix the code, not the assertion.'
  )
}

mkdirSync(dirname(MARKER), { recursive: true })
writeFileSync(MARKER, fingerprint, 'utf8')
process.exit(0)
