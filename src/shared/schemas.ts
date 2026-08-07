/**
 * Zod schemas for every IPC request payload and for persisted files.
 *
 * The main process validates *before* touching the filesystem or spawning
 * anything (NFR-13). Persisted data is validated on read so a hand-edited or
 * truncated file degrades into a recoverable error instead of a crash (FR-04).
 */
import { z } from 'zod'
import type { LayoutNode } from './types'
import {
  MAX_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_LINE_HEIGHT,
  MIN_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_LINE_HEIGHT
} from './terminalTypography'

export const themePreferenceSchema = z.enum(['light', 'dark', 'system'])

export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('terminal'),
      terminalId: z.string().min(1)
    }),
    z.object({
      type: z.literal('split'),
      direction: z.enum(['horizontal', 'vertical']),
      ratio: z.number().min(0.1).max(0.9),
      children: z.tuple([layoutNodeSchema, layoutNodeSchema])
    }),
    z.object({
      type: z.literal('tabs'),
      activeTabId: z.string().min(1),
      tabs: z.array(z.object({ id: z.string().min(1), layout: layoutNodeSchema })).min(1).max(64)
    })
  ])
)

/** Env var *names* only. Values live in the OS environment and are never stored (FR-18). */
export const envAllowlistSchema = z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(64)

export const terminalConfigSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  presetId: z.string().min(1).optional(),
  executable: z.string().min(1).max(1024),
  args: z.array(z.string().max(4096)).max(64),
  cwd: z.string().min(1).max(1024),
  envAllowlist: envAllowlistSchema
})

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  projectRoot: z.string().min(1).max(1024),
  layout: layoutNodeSchema.nullable(),
  terminals: z.array(terminalConfigSchema).max(64),
  activeTerminalId: z.string().min(1).optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export const agentPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  // A preset may be saved before it is configured (the built-in Custom
  // Command starts this way). TerminalConfig remains non-empty so launch is
  // still rejected before a process can be spawned.
  executable: z.string().max(1024),
  args: z.array(z.string().max(4096)).max(64),
  defaultCwd: z.string().max(1024),
  envAllowlist: envAllowlistSchema,
  builtIn: z.boolean(),
  installHint: z.string().max(500).optional()
})

export const appSettingsSchema = z.object({
  themePreference: themePreferenceSchema,
  terminalFontFamily: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^\P{Cc}+$/u)
    .nullable(),
  terminalFontSize: z.number().int().min(MIN_TERMINAL_FONT_SIZE).max(MAX_TERMINAL_FONT_SIZE),
  terminalLineHeight: z.number().min(MIN_TERMINAL_LINE_HEIGHT).max(MAX_TERMINAL_LINE_HEIGHT),
  scrollback: z.number().int().min(1000).max(200_000),
  confirmCloseRunning: z.boolean(),
  warnOnMultilinePaste: z.boolean(),
  defaultShellId: z.string().min(1).nullable()
})

export const WORKSPACE_SCHEMA_VERSION = 2
export const SETTINGS_SCHEMA_VERSION = 2
export const PRESETS_SCHEMA_VERSION = 1

export const workspaceFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  workspaces: z.array(workspaceSchema)
})

export const settingsFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  settings: appSettingsSchema
})

export const presetsFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  presets: z.array(agentPresetSchema)
})

/* ---------- IPC request payloads ---------- */

export const requestSchemas = {
  'app:info': z.void().or(z.undefined()),
  'app:update-status': z.void().or(z.undefined()),
  'app:update-check': z.void().or(z.undefined()),
  'app:update-install': z.void().or(z.undefined()),
  'workspace:list': z.void().or(z.undefined()),
  'workspace:get': z.object({ id: z.string().min(1) }),
  'workspace:create': z.object({
    name: z.string().min(1).max(120),
    projectRoot: z.string().min(1).max(1024)
  }),
  'workspace:update': z.object({
    id: z.string().min(1),
    patch: z.object({
      name: z.string().min(1).max(120).optional(),
      layout: layoutNodeSchema.nullable().optional(),
      terminals: z.array(terminalConfigSchema).max(64).optional(),
      activeTerminalId: z.string().min(1).nullable().optional()
    })
  }),
  'workspace:delete': z.object({ id: z.string().min(1) }),

  'terminal:create': z.object({
    workspaceId: z.string().min(1),
    terminalId: z.string().min(1),
    cols: z.number().int().min(1).max(2000),
    rows: z.number().int().min(1).max(2000)
  }),
  'terminal:write': z.object({
    terminalId: z.string().min(1),
    data: z.string().max(1_000_000)
  }),
  'terminal:resize': z.object({
    terminalId: z.string().min(1),
    cols: z.number().int().min(1).max(2000),
    rows: z.number().int().min(1).max(2000)
  }),
  'terminal:terminate': z.object({ terminalId: z.string().min(1) }),
  'terminal:restart': z.object({
    terminalId: z.string().min(1),
    cols: z.number().int().min(1).max(2000),
    rows: z.number().int().min(1).max(2000)
  }),
  'terminal:list-sessions': z.void().or(z.undefined()),

  'preset:list': z.void().or(z.undefined()),
  'preset:create': agentPresetSchema.omit({ id: true, builtIn: true }),
  'preset:update': z.object({
    id: z.string().min(1),
    patch: agentPresetSchema.omit({ id: true, builtIn: true }).partial()
  }),
  'preset:delete': z.object({ id: z.string().min(1) }),
  'preset:reset': z.void().or(z.undefined()),

  'git:branch': z.object({ path: z.string().min(1).max(1024) }),

  'shell:list': z.void().or(z.undefined()),
  'settings:get': z.void().or(z.undefined()),
  'settings:update': appSettingsSchema.partial(),
  'dialog:pick-directory': z.object({ defaultPath: z.string().max(1024).optional() }).optional(),
  'path:validate': z.object({
    path: z.string().min(1).max(1024),
    mustBeInside: z.string().max(1024).optional()
  })
} as const

export type RequestSchemas = typeof requestSchemas
export type IpcCommand = keyof RequestSchemas
