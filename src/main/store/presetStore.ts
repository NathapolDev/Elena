/**
 * Agent presets (FR-15..FR-19).
 *
 * A preset is configuration only: name, executable, args, cwd and the *names* of
 * environment variables the child may inherit. No secret value is ever stored
 * here (FR-18).
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { PRESETS_SCHEMA_VERSION, presetsFileSchema } from '@shared/schemas'
import type { AgentPreset } from '@shared/types'
import { loadJsonFile, writeJsonFileAtomic } from './atomicJson'
import { logger } from '../logger'

export const BUILT_IN_PRESETS: AgentPreset[] = [
  {
    id: 'builtin.claude-code',
    name: 'Claude Code',
    executable: 'claude',
    args: [],
    defaultCwd: '',
    envAllowlist: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK'],
    builtIn: true,
    installHint: 'Install with: npm install -g @anthropic-ai/claude-code'
  },
  {
    id: 'builtin.codex-cli',
    name: 'Codex CLI',
    executable: 'codex',
    args: [],
    defaultCwd: '',
    envAllowlist: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
    builtIn: true,
    installHint: 'Install with: npm install -g @openai/codex'
  },
  {
    id: 'builtin.custom',
    name: 'Custom Command',
    executable: '',
    args: [],
    defaultCwd: '',
    envAllowlist: [],
    builtIn: true,
    installHint: 'Set an executable and arguments in Settings → Presets.'
  }
]

type PresetsFile = { schemaVersion: number; presets: AgentPreset[] }

export class PresetStore {
  private file: PresetsFile = {
    schemaVersion: PRESETS_SCHEMA_VERSION,
    presets: structuredClone(BUILT_IN_PRESETS)
  }

  constructor(private readonly filePath = join(app.getPath('userData'), 'presets.json')) {}

  load(): void {
    const outcome = loadJsonFile<PresetsFile>(this.filePath, presetsFileSchema, () => ({
      schemaVersion: PRESETS_SCHEMA_VERSION,
      presets: structuredClone(BUILT_IN_PRESETS)
    }))
    this.file = outcome.data
    // A built-in added in a later version must appear for existing users too.
    for (const builtIn of BUILT_IN_PRESETS) {
      if (!this.file.presets.some((p) => p.id === builtIn.id)) {
        this.file.presets.push(structuredClone(builtIn))
      }
    }
    logger.info('presets.loaded', { count: this.file.presets.length })
  }

  list(): AgentPreset[] {
    return structuredClone(this.file.presets)
  }

  get(id: string): AgentPreset | undefined {
    const found = this.file.presets.find((p) => p.id === id)
    return found ? structuredClone(found) : undefined
  }

  create(input: Omit<AgentPreset, 'id' | 'builtIn'>): AgentPreset {
    const preset: AgentPreset = { ...input, id: randomUUID(), builtIn: false }
    this.file.presets.push(preset)
    this.save()
    return structuredClone(preset)
  }

  update(id: string, patch: Partial<Omit<AgentPreset, 'id' | 'builtIn'>>): AgentPreset | undefined {
    const preset = this.file.presets.find((p) => p.id === id)
    if (!preset) return undefined
    Object.assign(preset, patch)
    this.save()
    return structuredClone(preset)
  }

  /** Built-in presets cannot be deleted; they are reset instead (FR-19). */
  delete(id: string): boolean {
    const index = this.file.presets.findIndex((p) => p.id === id)
    if (index === -1) return false
    if (this.file.presets[index]?.builtIn) return false
    this.file.presets.splice(index, 1)
    this.save()
    return true
  }

  resetBuiltIns(): AgentPreset[] {
    const custom = this.file.presets.filter((p) => !p.builtIn)
    this.file.presets = [...structuredClone(BUILT_IN_PRESETS), ...custom]
    this.save()
    return this.list()
  }

  private save(): void {
    try {
      writeJsonFileAtomic(this.filePath, this.file)
    } catch (error) {
      logger.error('presets.save-failed', { error })
    }
  }
}
