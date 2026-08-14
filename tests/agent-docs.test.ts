/**
 * Guard suite: the agent governance layer itself.
 *
 * Rules, subagents, skills and hooks are only worth anything if they exist, are
 * loadable, and point at real files. This suite is what keeps the layer from
 * rotting the way an uncommitted convention does.
 *
 * A failure here means the governance config is broken, not that the test is
 * stale.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const CLAUDE_DIR = join(ROOT, '.claude')

function frontmatter(source: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (!match?.[1]) return {}
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return fields
}

describe('rules layer', () => {
  it('keeps AGENTS.md as the single source of truth', () => {
    const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
    expect(agents.length).toBeGreaterThan(2000)
    expect(agents).toContain('Conventions that are load-bearing')
  })

  it('imports AGENTS.md from CLAUDE.md instead of duplicating it', () => {
    const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('@AGENTS.md')
    // A CLAUDE.md that grew back into a full copy is drift waiting to happen.
    expect(claude.length).toBeLessThan(3000)
  })

  it('still keeps machine-local settings out of git', () => {
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8')).toContain('.claude/settings.local.json')
  })
})

describe('.claude/settings.json', () => {
  const settingsPath = join(CLAUDE_DIR, 'settings.json')
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
    permissions?: { allow?: string[]; deny?: string[] }
    hooks?: Record<string, { hooks?: { command?: string }[] }[]>
  }

  it('parses and declares permissions', () => {
    expect(settings.permissions?.allow?.length ?? 0).toBeGreaterThan(0)
    expect(settings.permissions?.deny ?? []).toContain('Edit(./.claude/settings.local.json)')
  })

  it('does not allow state-changing commands without a prompt', () => {
    const allow = settings.permissions?.allow ?? []
    const forbidden = ['git commit', 'git push', 'npm ci', 'npm install', 'build:win']
    const leaked = allow.filter((rule) => forbidden.some((command) => rule.includes(command)))
    expect(leaked).toEqual([])
  })

  it('points every hook at a script that exists', () => {
    const commands = Object.values(settings.hooks ?? {})
      .flat()
      .flatMap((matcher) => matcher.hooks ?? [])
      .map((hook) => hook.command ?? '')

    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      const script = /(\.claude\/hooks\/[\w.-]+\.mjs)/.exec(command)?.[1]
      expect(script, `hook command has no .claude/hooks script: ${command}`).toBeDefined()
      expect(existsSync(join(ROOT, script ?? '')), `missing hook script: ${script}`).toBe(true)
    }
  })
})

describe('subagents', () => {
  const dir = join(CLAUDE_DIR, 'agents')
  const files = readdirSync(dir).filter((name) => name.endsWith('.md'))

  it('has at least one', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s has frontmatter whose name matches the filename', (file) => {
    const fields = frontmatter(readFileSync(join(dir, file), 'utf8'))
    expect(fields.name).toBe(file.replace(/\.md$/, ''))
    expect((fields.description ?? '').length).toBeGreaterThan(30)
  })
})

describe('skills', () => {
  const dir = join(CLAUDE_DIR, 'skills')
  const skills = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory())

  it('has at least one', () => {
    expect(skills.length).toBeGreaterThan(0)
  })

  it.each(skills)('%s/SKILL.md has frontmatter whose name matches the directory', (skill) => {
    const path = join(dir, skill, 'SKILL.md')
    expect(existsSync(path), `missing ${skill}/SKILL.md`).toBe(true)

    const fields = frontmatter(readFileSync(path, 'utf8'))
    expect(fields.name).toBe(skill)
    expect((fields.description ?? '').length).toBeGreaterThan(30)
  })
})
