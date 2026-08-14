/**
 * PostToolUse hook: run the IPC guard suites when the contract is touched.
 *
 * The IPC contract is the one place in this repo where a half-finished edit
 * produces a *silent* runtime failure — a missing EVENT_CHANNELS entry means the
 * event never arrives, with no error and no log. These three suites take about a
 * second, and this hook exits in well under 50 ms for every other file.
 *
 * Exit codes: 0 = fine or not applicable, 2 = blocking error shown to Claude.
 */
import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { readHookPayload } from './_payload.mjs'

const CONTRACT_PATHS = [
  'src/shared/ipc.ts',
  'src/shared/schemas.ts',
  'src/main/ipc/',
  'src/preload/'
]

const SUITES = ['tests/ipc-contract.test.ts', 'tests/ipc-preload.test.ts', 'tests/ipc-bus.test.ts']

const payload = readHookPayload()
const filePath = payload?.tool_input?.file_path
if (!filePath) process.exit(0)

const rel = relative(process.cwd(), resolve(filePath)).replaceAll('\\', '/')
if (!CONTRACT_PATHS.some((path) => rel.startsWith(path))) process.exit(0)

const result = spawnSync('npx', ['vitest', 'run', ...SUITES, '--reporter=dot'], {
  encoding: 'utf8',
  shell: true
})

if (result.status === 0) process.exit(0)

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
process.stderr.write(
  `The IPC contract guards failed after editing ${rel}.\n` +
    'These encode the contract, not a behaviour — fix the code, not the assertion.\n\n' +
    `${output}\n`
)
process.exit(2)
