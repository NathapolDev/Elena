/**
 * PostToolUse hook: lint the file that was just edited.
 *
 * Runs the same ESLint that CI runs, but on one file and immediately, so a
 * type-import or unused-variable slip is fixed in the turn that created it
 * rather than minutes later in CI.
 *
 * Written as a Node script rather than an inline command because hook commands
 * are handed to the OS shell, and quoting differs between PowerShell, cmd and
 * Git Bash. Reading stdin here keeps the behaviour identical everywhere.
 *
 * Exit codes: 0 = fine or not applicable, 2 = blocking error shown to Claude.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { readHookPayload } from './_payload.mjs'

const LINTED_ROOTS = ['src/', 'tests/', 'e2e/']

const payload = readHookPayload()
const filePath = payload?.tool_input?.file_path
if (!filePath) process.exit(0)

const rel = relative(process.cwd(), resolve(filePath)).replaceAll('\\', '/')
const applies =
  /\.(ts|tsx)$/.test(rel) && LINTED_ROOTS.some((root) => rel.startsWith(root)) && existsSync(filePath)

if (!applies) process.exit(0)

const result = spawnSync('npx', ['eslint', '--no-warn-ignored', rel], {
  encoding: 'utf8',
  shell: true
})

if (result.status === 0) process.exit(0)

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
process.stderr.write(`ESLint failed on ${rel}:\n${output}\n`)
process.exit(2)
