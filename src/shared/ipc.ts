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
  Result,
  RuntimeSession,
  SessionStatus,
  ShellInfo,
  TerminalConfig,
  UpdateState,
  Workspace
} from './types'

export type Commands = {
  /**
   * The renderer has installed its event subscriptions and can receive
   * broadcasts. `did-finish-load` fires before React runs the effect that
   * subscribes, and the bus does not buffer, so main has no other way to know
   * an event it sends will actually be heard.
   *
   * Sent by the main window only, once per load. A detached window renders a
   * single terminal and returns early from every app-level broadcast, so
   * nothing waits on its readiness — and the handler cannot tell senders apart,
   * since `registerCommand` deliberately hands the payload and not the event.
   */
  'app:renderer-ready': { req: void; res: { acknowledged: true } }
  'app:info': { req: void; res: AppInfo }
  'app:update-status': { req: void; res: UpdateState }
  'app:update-check': { req: void; res: UpdateState }
  'app:update-install': { req: void; res: { started: true } }

  'workspace:list': { req: void; res: Workspace[] }
  'workspace:get': { req: { id: string }; res: Workspace }
  'workspace:create': { req: { name: string; projectRoot: string }; res: Workspace }
  /**
   * Returns the scratch workspace, creating it on the home directory the first
   * time. Idempotent: a fixed id means Quick Session never accumulates
   * duplicates. Every PTY needs a workspace for its cwd jail, so this is how a
   * session starts without the user preparing one (FR-01).
   */
  'workspace:ensure-scratch': { req: void; res: Workspace }
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

  /**
   * Opens a terminal in its own window. The PTY does not move — only the UI
   * that renders it — so the response is just the new set of detached ids.
   */
  'window:detach': { req: { workspaceId: string; terminalId: string; title: string }; res: { terminalIds: string[] } }
  'window:reattach': { req: { terminalId: string }; res: { terminalIds: string[] } }
  /** Detached state is in-memory in main, so a fresh renderer has to ask. */
  'window:detached': { req: void; res: { terminalIds: string[] } }

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
  /**
   * Explorer's "Open in Elena" reached a running app: switch the main window to
   * this workspace. Always preceded by `workspace:changed`, since the workspace
   * may have just been created for the folder.
   */
  'workspace:open-requested': { workspaceId: string }
  /** The full set, not a delta, so a late-arriving window cannot miss one. */
  'window:detached-changed': { terminalIds: string[] }
  'theme:changed': { resolvedTheme: ResolvedTheme }
  'app:error': AppError
  'app:update-state': UpdateState
}

export type EventName = keyof Events
export type EventPayload<E extends EventName> = Events[E]

/**
 * The channel allowlists are `as const` **without** a type annotation on purpose.
 * Annotating them `readonly CommandName[]` widens the literal tuple back to an
 * array, and a missing entry then compiles cleanly — which for events is silent:
 * `subscribe` returns a no-op unsubscribe and the event never arrives. The
 * exhaustiveness assertion below is what turns that into a compile error.
 */
export const COMMAND_CHANNELS = [
  'app:renderer-ready',
  'app:info',
  'app:update-status',
  'app:update-check',
  'app:update-install',
  'workspace:list',
  'workspace:get',
  'workspace:create',
  'workspace:ensure-scratch',
  'workspace:update',
  'workspace:delete',
  'window:detach',
  'window:reattach',
  'window:detached',
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
] as const satisfies readonly CommandName[]

export const EVENT_CHANNELS = [
  'terminal:data',
  'terminal:status-changed',
  'terminal:exit',
  'workspace:changed',
  'workspace:open-requested',
  'window:detached-changed',
  'theme:changed',
  'app:error',
  'app:update-state'
] as const satisfies readonly EventName[]

/**
 * Contract completeness. `satisfies` above proves every listed channel is real;
 * these prove the converse — that every declared command and event is listed.
 * Adding a `Commands`/`Events` member without an allowlist entry resolves the
 * matching type to `never` and fails `npm run typecheck`.
 *
 * Exported rather than a bare local so `noUnusedLocals` stays happy, and read by
 * `tests/ipc-contract.test.ts` so deleting it is also a test failure.
 */
type CommandChannelsComplete =
  Exclude<CommandName, (typeof COMMAND_CHANNELS)[number]> extends never ? true : never
type EventChannelsComplete =
  Exclude<EventName, (typeof EVENT_CHANNELS)[number]> extends never ? true : never

export const CONTRACT_COMPLETE: readonly [CommandChannelsComplete, EventChannelsComplete] = [true, true]

/**
 * The bridge shape on `window.elena`.
 *
 * It lives here rather than in the preload because it is the one part of the
 * contract both sides need and neither project can reach the other's copy:
 * `tsconfig.web.json` includes only `src/preload/*.d.ts`, so the renderer cannot
 * import `src/preload/index.ts` (it pulls in `electron`). Declaring the shape
 * once in shared code means `index.ts` (implementation) and `index.d.ts`
 * (`Window` augmentation) are checked against the same type instead of two
 * hand-written copies that drift silently.
 */
export type WorkspacesApi = {
  invoke<C extends CommandName>(
    channel: C,
    payload?: CommandRequest<C>
  ): Promise<Result<CommandResponse<C>>>
  subscribe<E extends EventName>(channel: E, listener: (payload: EventPayload<E>) => void): () => void
  platform: string
  /** Windows build number (eg. 26200), or null off Windows. */
  windowsBuild: number | null
  zoomIn(): number
  zoomOut(): number
}
