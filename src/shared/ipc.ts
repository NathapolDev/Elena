/**
 * The IPC contract. Both sides import this file, so a renderer call that does
 * not exist in the main process is a compile error rather than a runtime one.
 *
 * Channel names are an explicit allowlist (NFR-11): the preload refuses to
 * forward anything that is not in these two arrays.
 */
import type {
  AgentPreset,
  AppError,
  AppInfo,
  AppSettings,
  GitBranchInfo,
  LayoutNode,
  ResolvedTheme,
  RuntimeSession,
  SessionStatus,
  ShellInfo,
  TerminalConfig,
  Workspace
} from './types'

export type Commands = {
  'app:info': { req: void; res: AppInfo }

  'workspace:list': { req: void; res: Workspace[] }
  'workspace:get': { req: { id: string }; res: Workspace }
  'workspace:create': { req: { name: string; projectRoot: string }; res: Workspace }
  'workspace:update': {
    req: {
      id: string
      patch: {
        name?: string
        layout?: LayoutNode | null
        terminals?: TerminalConfig[]
        activeTerminalId?: string | null
      }
    }
    res: Workspace
  }
  'workspace:delete': { req: { id: string }; res: { id: string } }

  'terminal:create': {
    req: { workspaceId: string; terminalId: string; cols: number; rows: number }
    res: RuntimeSession
  }
  'terminal:write': { req: { terminalId: string; data: string }; res: null }
  'terminal:resize': { req: { terminalId: string; cols: number; rows: number }; res: null }
  'terminal:terminate': { req: { terminalId: string }; res: null }
  'terminal:restart': {
    req: { terminalId: string; cols: number; rows: number }
    res: RuntimeSession
  }
  'terminal:list-sessions': { req: void; res: RuntimeSession[] }

  'preset:list': { req: void; res: AgentPreset[] }
  'preset:create': { req: Omit<AgentPreset, 'id' | 'builtIn'>; res: AgentPreset }
  'preset:update': {
    req: { id: string; patch: Partial<Omit<AgentPreset, 'id' | 'builtIn'>> }
    res: AgentPreset
  }
  'preset:delete': { req: { id: string }; res: { id: string } }
  'preset:reset': { req: void; res: AgentPreset[] }

  /** Null when the folder is not inside a git working tree. */
  'git:branch': { req: { path: string }; res: GitBranchInfo | null }

  'shell:list': { req: void; res: ShellInfo[] }
  'settings:get': { req: void; res: { settings: AppSettings; resolvedTheme: ResolvedTheme } }
  'settings:update': {
    req: Partial<AppSettings>
    res: { settings: AppSettings; resolvedTheme: ResolvedTheme }
  }
  'dialog:pick-directory': { req: { defaultPath?: string } | undefined; res: { path: string } | null }
  'path:validate': {
    req: { path: string; mustBeInside?: string }
    res: { path: string; exists: boolean; isDirectory: boolean }
  }
}

export type CommandName = keyof Commands
export type CommandRequest<C extends CommandName> = Commands[C]['req']
export type CommandResponse<C extends CommandName> = Commands[C]['res']

export type Events = {
  'terminal:data': { terminalId: string; chunk: string }
  'terminal:status-changed': { terminalId: string; status: SessionStatus; pid?: number }
  'terminal:exit': {
    terminalId: string
    exitCode?: number
    signal?: number
    endedAt: string
  }
  'workspace:changed': { workspaceId: string | null }
  'theme:changed': { resolvedTheme: ResolvedTheme }
  'app:error': AppError
}

export type EventName = keyof Events
export type EventPayload<E extends EventName> = Events[E]

export const COMMAND_CHANNELS: readonly CommandName[] = [
  'app:info',
  'workspace:list',
  'workspace:get',
  'workspace:create',
  'workspace:update',
  'workspace:delete',
  'terminal:create',
  'terminal:write',
  'terminal:resize',
  'terminal:terminate',
  'terminal:restart',
  'terminal:list-sessions',
  'preset:list',
  'preset:create',
  'preset:update',
  'preset:delete',
  'preset:reset',
  'git:branch',
  'shell:list',
  'settings:get',
  'settings:update',
  'dialog:pick-directory',
  'path:validate'
] as const

export const EVENT_CHANNELS: readonly EventName[] = [
  'terminal:data',
  'terminal:status-changed',
  'terminal:exit',
  'workspace:changed',
  'theme:changed',
  'app:error'
] as const
