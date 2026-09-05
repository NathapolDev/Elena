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

export type GitChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

/** Runtime Git state. Paths are always relative to the workspace project root. */
export type GitChangeEntry = {
  path: string
  previousPath?: string
  kind: GitChangeKind
  staged: boolean
  unstaged: boolean
  /** An untracked working-tree entry can coexist with a staged deletion at this path. */
  untracked?: boolean
  /** False for deleted files, directories and paths that fail the workspace jail. */
  openable: boolean
}

export type GitChangesSnapshot = {
  repository: GitBranchInfo
  files: GitChangeEntry[]
  /** True when the bounded status result omitted additional entries. */
  truncated: boolean
  /** Sum of staged and working-tree line changes, including readable untracked text. */
  summary?: { additions: number; deletions: number; incomplete: boolean }
}

export type GitDiffSection = {
  source: 'staged' | 'working-tree' | 'untracked'
  patch: string
  binary: boolean
  truncated: boolean
}

export type GitFileDiff = {
  path: string
  previousPath?: string
  sections: GitDiffSection[]
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
  terminalFontFamily: string | null
  terminalFontSize: number
  terminalLineHeight: number
  scrollback: number
  confirmCloseRunning: boolean
  warnOnMultilinePaste: boolean
  defaultShellId: string | null
  /** Windows only: whether the "Open in Elena" Explorer verb is registered. */
  explorerContextMenu: boolean
  /**
   * Draw terminals with the GPU (xterm's WebGL renderer) instead of the DOM.
   * On by default. Off is the honest choice on a machine with no usable GL
   * context — a remote desktop, a VM, a blocklisted driver — where the software
   * GL fallback is slower than the DOM renderer it replaced.
   */
  gpuRendering: boolean
}

export type ResolvedTheme = 'light' | 'dark'

export type AppInfo = {
  appVersion: string
  electronVersion: string
  developer: string
  /** A dev run has no stable executable path, so some OS integrations are off. */
  packaged: boolean
}

export type UpdateState =
  | { status: 'idle'; currentVersion: string; supported: boolean }
  | { status: 'checking'; currentVersion: string }
  | { status: 'up-to-date'; currentVersion: string; latestVersion: string }
  | {
      status: 'downloading'
      currentVersion: string
      latestVersion: string
      percent: number
      transferred: number
      total: number
      bytesPerSecond: number
    }
  | { status: 'ready'; currentVersion: string; latestVersion: string }
  | { status: 'error'; currentVersion: string; latestVersion?: string; message: string }

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
