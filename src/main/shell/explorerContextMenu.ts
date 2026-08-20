/**
 * The Windows Explorer "Open in Elena" verb (HKCU registry entries).
 *
 * Written twice on purpose: the NSIS installer creates the keys so a fresh
 * install has the entry before Elena is ever launched, and this module
 * re-applies or removes them at runtime for the Settings toggle and to refresh
 * the recorded executable path after an update. `build/installer.nsh` must stay
 * byte-identical in label, key name and command — `tests/explorerContextMenu.test.ts`
 * is what catches a half-finished rename.
 *
 * Everything goes under `HKCU\Software\Classes` because the installer is
 * per-user (`perMachine: false`): a per-machine write would need elevation the
 * app never asks for.
 *
 * `reg.exe` is invoked as executable + argv, never as a composed shell string
 * (NFR-12), and the values are built by a pure function so the shape is unit
 * testable without touching a registry.
 */
import { execFileSync } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { OPEN_FOLDER_FLAG } from './openFolderArgs'

/** The verb's key name. Shared with `build/installer.nsh` — change both or neither. */
export const CONTEXT_MENU_KEY = 'ElenaOpenFolder'

/** The label Explorer shows next to the Elena icon. */
export const CONTEXT_MENU_LABEL = 'Open in Elena'

/**
 * Right-clicking a folder, right-clicking the empty background inside an open
 * folder, and right-clicking a drive are three different shell classes.
 */
const ROOTS = ['Directory', 'Directory\\Background', 'Drive'] as const

export type RegistryEntry = {
  key: string
  /** Empty string means the key's default value, which is what `reg add /ve` writes. */
  name: string
  value: string
}

export function contextMenuKeys(): string[] {
  return ROOTS.map((root) => `HKCU\\Software\\Classes\\${root}\\shell\\${CONTEXT_MENU_KEY}`)
}

/**
 * `%V` rather than `%1`: it is the only token Explorer expands for all three
 * classes, and `%1` yields nothing on `Directory\Background`.
 *
 * The trailing `\.` is not decoration. A drive root expands to `C:\`, and
 * `CommandLineToArgvW` reads the backslash in `"C:\"` as escaping the closing
 * quote — the app would receive `C:"` and reject it as missing. Ending the
 * argument on a character that is not a backslash removes the ambiguity, and
 * `path.resolve` folds the `\.` away for every folder.
 */
export function contextMenuCommand(exePath: string): string {
  return `"${exePath}" ${OPEN_FOLDER_FLAG} "%V\\."`
}

/**
 * A value name of Elena's own, holding every other value this module writes.
 * Comparing this one string is how a launch decides the verb is already current
 * instead of reading each value back, and deriving it from the others means it
 * cannot claim a value it does not cover. `build/installer.nsh` writes it too.
 *
 * It is written **last**, so it is a commit marker: a run interrupted between
 * `reg.exe` calls leaves a key without the stamp, and the next launch repairs
 * it rather than trusting a verb that was never finished.
 */
export const CONTEXT_MENU_STATE_VALUE = 'ElenaVerbState'

/** Everything but the stamp: label, icon, command. */
function verbValues(exePath: string, key: string): RegistryEntry[] {
  return [
    { key, name: '', value: CONTEXT_MENU_LABEL },
    // Pointing the icon at the executable is what puts Elena's own icon in the menu.
    { key, name: 'Icon', value: `"${exePath}",0` },
    { key: `${key}\\command`, name: '', value: contextMenuCommand(exePath) }
  ]
}

export function contextMenuState(exePath: string): string {
  return verbValues(exePath, '')
    .map((entry) => entry.value)
    .join('|')
}

export function contextMenuEntries(exePath: string): RegistryEntry[] {
  return contextMenuKeys().flatMap((key) => [
    ...verbValues(exePath, key),
    { key, name: CONTEXT_MENU_STATE_VALUE, value: contextMenuState(exePath) }
  ])
}

/** Only a packaged Windows build has a stable executable path worth registering. */
export function explorerContextMenuSupported(packaged: boolean): boolean {
  return process.platform === 'win32' && packaged
}

/**
 * True when the registry already says exactly what `register` would write.
 * Every launch reconciles the verb, and a dozen `reg add` calls to change
 * nothing is startup time spent for no reason.
 */
export function explorerContextMenuMatches(exePath: string): boolean {
  const expected = contextMenuState(exePath)
  return contextMenuKeys().every((key) => queryValue(key, CONTEXT_MENU_STATE_VALUE) === expected)
}

/**
 * True when none of the three keys exist, i.e. the verb is already gone. Asks
 * by exit status rather than by reading a value: this is the branch that has to
 * keep working, since the installer rewrites all three keys on every update
 * even for a user who turned the toggle off.
 */
export function explorerContextMenuAbsent(): boolean {
  return contextMenuKeys().every((key) => !keyExists(key))
}

export function registerExplorerContextMenu(exePath: string): void {
  for (const entry of contextMenuEntries(exePath)) {
    reg(['add', entry.key, ...(entry.name ? ['/v', entry.name] : ['/ve']), '/t', 'REG_SZ', '/d', entry.value, '/f'])
  }
}

export function unregisterExplorerContextMenu(): void {
  for (const key of contextMenuKeys()) {
    // A key that is already gone is the state this function asks for; anything
    // else is a real failure and has to reach the caller, or a settings write
    // would record a verb the user can still see.
    if (keyExists(key)) reg(['delete', key, '/f'])
  }
}

function keyExists(key: string): boolean {
  try {
    execFileSync(regExecutable(), ['query', key], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

/** Null when the key or the value does not exist. */
function queryValue(key: string, name: string): string | null {
  let output: string
  try {
    output = execFileSync(regExecutable(), ['query', key, '/v', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
  } catch {
    return null
  }
  // `reg query` prints "    <name>    REG_SZ    <value>". Anchor on the type,
  // never on the name column: `reg.exe` localizes `(Default)` and this must
  // hold on a non-English Windows too.
  const match = /\s+REG_SZ\s+(.*)/.exec(output)
  return match?.[1]?.trimEnd() ?? null
}

function reg(args: string[]): void {
  try {
    execFileSync(regExecutable(), args, { stdio: 'ignore', windowsHide: true })
  } catch (error) {
    // Node puts the whole command line in the message, which for `reg add`
    // includes the user's profile path. Re-throw with the exit status only, so
    // nothing a caller logs can carry it (NFR-09).
    const status = (error as { status?: number }).status
    throw new Error(`reg.exe ${args[0]} failed${status === undefined ? '' : ` with exit code ${status}`}.`)
  }
}

/**
 * Absolute, never `PATH`. This runs unattended on every launch, so resolving it
 * the way a shell would means a `reg.exe` planted earlier on `PATH` gets
 * executed with no user intent behind it. `%SystemRoot%` is only honoured when
 * it is an absolute path, so a relative or empty value cannot redirect it
 * either.
 */
function regExecutable(): string {
  const root = process.env.SystemRoot
  return join(root && isAbsolute(root) ? root : 'C:\\Windows', 'System32', 'reg.exe')
}
