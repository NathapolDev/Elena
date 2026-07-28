/**
 * Shell discovery (FR-06). Only shells actually present on the machine are
 * offered, so the user cannot pick something that will fail to spawn.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveExecutable } from '../security/paths'
import type { ShellInfo } from '@shared/types'

type Candidate = {
  id: string
  name: string
  /** Absolute paths tried first; falls back to a PATH lookup on the executable. */
  paths: string[]
  executable: string
  args: string[]
}

function windowsCandidates(): Candidate[] {
  const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return [
    {
      id: 'pwsh',
      name: 'PowerShell 7',
      paths: [join(programFiles, 'PowerShell', '7', 'pwsh.exe')],
      executable: 'pwsh.exe',
      args: ['-NoLogo']
    },
    {
      id: 'windows-powershell',
      name: 'Windows PowerShell',
      paths: [join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')],
      executable: 'powershell.exe',
      args: ['-NoLogo']
    },
    {
      id: 'cmd',
      name: 'Command Prompt',
      paths: [join(systemRoot, 'System32', 'cmd.exe')],
      executable: 'cmd.exe',
      args: []
    },
    {
      id: 'git-bash',
      name: 'Git Bash',
      paths: [join(programFiles, 'Git', 'bin', 'bash.exe')],
      executable: 'bash.exe',
      args: ['-i', '-l']
    }
  ]
}

function posixCandidates(): Candidate[] {
  return [
    { id: 'zsh', name: 'zsh', paths: ['/bin/zsh', '/usr/bin/zsh'], executable: 'zsh', args: ['-l'] },
    {
      id: 'bash',
      name: 'bash',
      paths: ['/bin/bash', '/usr/bin/bash'],
      executable: 'bash',
      args: ['-l']
    },
    { id: 'sh', name: 'sh', paths: ['/bin/sh'], executable: 'sh', args: [] }
  ]
}

export function discoverShells(): ShellInfo[] {
  const candidates = process.platform === 'win32' ? windowsCandidates() : posixCandidates()
  const found: ShellInfo[] = []

  for (const candidate of candidates) {
    const direct = candidate.paths.find((p) => existsSync(p))
    const executable = direct ?? resolveExecutable(candidate.executable)
    if (!executable) continue
    found.push({
      id: candidate.id,
      name: candidate.name,
      executable,
      args: [...candidate.args]
    })
  }
  return found
}

export function defaultShell(shells: ShellInfo[], preferredId: string | null): ShellInfo | undefined {
  if (preferredId) {
    const preferred = shells.find((s) => s.id === preferredId)
    if (preferred) return preferred
  }
  return shells[0]
}
