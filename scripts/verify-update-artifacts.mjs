import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { stdout } from 'node:process'

const releaseDir = resolve('release')
const files = readdirSync(releaseDir)
const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const installer = `Elena-${version}-x64.exe`
const required = [
  { label: 'NSIS installer', matches: (name) => name === installer },
  { label: 'differential update blockmap', matches: (name) => name === `${installer}.blockmap` },
  { label: 'latest channel metadata', matches: (name) => name === 'latest.yml' }
]

const missing = required.filter(({ matches }) => !files.some(matches)).map(({ label }) => label)
if (missing.length > 0) {
  throw new Error(`Windows package is missing: ${missing.join(', ')}`)
}

stdout.write('Verified updater artifacts: installer, blockmap, and latest.yml\n')
