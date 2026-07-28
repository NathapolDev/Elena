/**
 * Domain types shared by main, preload and renderer.
 *
 * Everything crossing the process boundary must be structured-clone friendly:
 * plain objects, arrays and primitives only. Never a node-pty handle, a Buffer
 * or anything holding a Node primitive (NFR-11).
 */

export type LayoutNode =
  | { type: 'terminal'; terminalId: string }
  | {
      type: 'split'
      direction: 'horizontal' | 'vertical'
      ratio: number
      children: [LayoutNode, LayoutNode]
    }
  | {
      type: 'tabs'
      activeTabId: string
      tabs: Array<{ id: string; layout: LayoutNode }>
    }

export type TerminalConfig = {
  id: string
  title: string
  presetId?: string
  executable: string
  args: string[]
  cwd: string
  envAllowlist: string[]
}

export type Workspace = {
  id: string
  name: string
  projectRoot: string
  layout: LayoutNode | null
  terminals: TerminalConfig[]
  activeTerminalId?: string
  createdAt: string
  updatedAt: string
}

/** Runtime-only. Never persisted: a restored session is a config, not a process (FR-14). */
export type SessionStatus = 'starting' | 'running' | 'exited' | 'error'

export type RuntimeSession = {
  terminalId: string
  pid?: number
  status: SessionStatus
  exitCode?: number
  signal?: number
  errorMessage?: string
  startedAt?: string
  endedAt?: string
}

export type AgentPreset = {
  id: string
  name: string
  executable: string
  args: string[]
  /** Relative to the workspace project root. Empty string means the root itself. */
  defaultCwd: string
  envAllowlist: string[]
  builtIn: boolean
  /** Shown when the executable cannot be resolved (FR-17). */
  installHint?: string
}

/** Read from `.git` on demand; never persisted (FR-14 — configuration only). */
export type GitBranchInfo = {
  /** Absolute path of the working-tree root. */
  root: string
  /** Branch name, or the short commit id when HEAD is detached. */
  branch: string
  detached: boolean
}

export type ShellInfo = {
  id: string
  name: string
  executable: string
  args: string[]
}

export type ThemePreference = 'light' | 'dark' | 'system'

export type AppSettings = {
  themePreference: ThemePreference
  scrollback: number
  confirmCloseRunning: boolean
  warnOnMultilinePaste: boolean
  defaultShellId: string | null
}

export type ResolvedTheme = 'light' | 'dark'

export type AppInfo = {
  appVersion: string
  electronVersion: string
  developer: string
}

export type AppErrorCode =
  | 'EXECUTABLE_NOT_FOUND'
  | 'INVALID_CWD'
  | 'SPAWN_FAILED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'PERSISTENCE_FAILED'
  | 'INTERNAL'

export type AppError = {
  code: AppErrorCode
  message: string
  /** Optional next step the UI can offer, e.g. "open-preset-settings". */
  action?: 'open-preset-settings' | 'choose-directory' | 'retry' | 'open-settings'
}

/** Every IPC command resolves to this. Raw errors never cross the boundary. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }
