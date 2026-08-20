/**
 * Guard suite: the Explorer verb's registry shape.
 *
 * The same three keys are written twice — here at runtime and by
 * `build/installer.nsh` at install time — so this pins the shape and the
 * installer script is checked against it. A drift means one of the two paths
 * would leave a verb the other cannot remove.
 */
import { readFileSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_KEY,
  CONTEXT_MENU_LABEL,
  CONTEXT_MENU_STATE_VALUE,
  contextMenuCommand,
  contextMenuState,
  contextMenuEntries,
  contextMenuKeys,
  explorerContextMenuSupported
} from '../src/main/shell/explorerContextMenu'
import { OPEN_FOLDER_FLAG } from '../src/main/shell/openFolderArgs'

const EXE = 'C:\\Users\\dev\\AppData\\Local\\Programs\\Elena\\Elena.exe'

describe('explorer context menu entries', () => {
  it('covers folders, folder backgrounds and drives', () => {
    expect(contextMenuKeys()).toEqual([
      `HKCU\\Software\\Classes\\Directory\\shell\\${CONTEXT_MENU_KEY}`,
      `HKCU\\Software\\Classes\\Directory\\Background\\shell\\${CONTEXT_MENU_KEY}`,
      `HKCU\\Software\\Classes\\Drive\\shell\\${CONTEXT_MENU_KEY}`
    ])
  })

  it('stays under HKCU, which is the only hive a per-user install may write', () => {
    for (const key of contextMenuKeys()) expect(key.startsWith('HKCU\\')).toBe(true)
  })

  it('labels every root and points the icon at the executable', () => {
    const entries = contextMenuEntries(EXE)
    for (const key of contextMenuKeys()) {
      expect(entries).toContainEqual({ key, name: '', value: CONTEXT_MENU_LABEL })
      expect(entries).toContainEqual({ key, name: 'Icon', value: `"${EXE}",0` })
    }
  })

  it('passes the folder with %V, the only token all three roots expand', () => {
    const commands = contextMenuEntries(EXE).filter((entry) => entry.key.endsWith('\\command'))
    expect(commands).toHaveLength(3)
    for (const command of commands) {
      expect(command.value).toBe(contextMenuCommand(EXE))
      expect(command.value).toContain(`${OPEN_FOLDER_FLAG} "%V`)
      expect(command.value).not.toContain('%1')
    }
  })

  it('never lets the argument end on a backslash, or a drive root loses its quote', () => {
    // `%V` on `Drive` expands to `C:\`, and CommandLineToArgvW would read that
    // backslash as escaping the closing quote.
    expect(contextMenuCommand(EXE).endsWith('\\."')).toBe(true)
    expect(contextMenuCommand(EXE)).not.toContain('%V"')
    // What Explorer produces for a drive root still resolves to that drive, and
    // an ordinary folder is unchanged by the suffix.
    expect(win32.resolve('C:\\' + '\\.')).toBe('C:\\')
    expect(win32.resolve('C:\\Projects\\App' + '\\.')).toBe('C:\\Projects\\App')
  })

  it('stamps every key with what was written, so a launch can skip rewriting it', () => {
    const entries = contextMenuEntries(EXE)
    for (const key of contextMenuKeys()) {
      expect(entries).toContainEqual({
        key,
        name: CONTEXT_MENU_STATE_VALUE,
        value: contextMenuState(EXE)
      })
    }
    // The stamp has to change when any written value does, or a stale verb
    // survives forever — so it must carry every other value, not a subset.
    for (const entry of entries.filter((item) => item.name !== CONTEXT_MENU_STATE_VALUE)) {
      expect(contextMenuState(EXE)).toContain(entry.value)
    }
    expect(contextMenuState(EXE)).not.toBe(contextMenuState(`${EXE}.old`))
  })

  it('writes the stamp last, so it can only mark a finished verb', () => {
    const entries = contextMenuEntries(EXE)
    for (const key of contextMenuKeys()) {
      const forKey = entries.filter((entry) => entry.key === key || entry.key === `${key}\\command`)
      expect(forKey.at(-1)).toEqual({
        key,
        name: CONTEXT_MENU_STATE_VALUE,
        value: contextMenuState(EXE)
      })
    }
  })

  it('is offered only where a stable executable path exists', () => {
    expect(explorerContextMenuSupported(false)).toBe(false)
    if (process.platform !== 'win32') expect(explorerContextMenuSupported(true)).toBe(false)
  })
})

describe('installer script', () => {
  const script = readFileSync(join(process.cwd(), 'build', 'installer.nsh'), 'utf8')

  it('writes and removes the same keys the app does', () => {
    for (const key of contextMenuKeys()) {
      const withoutHive = key.replace('HKCU\\', '')
      expect(script).toContain(`DeleteRegKey HKCU "${withoutHive}"`)
    }
    // The roots are written through one macro, so the class names are what to look for.
    expect(script).toContain('!insertmacro ElenaWriteVerb "Directory"')
    expect(script).toContain('!insertmacro ElenaWriteVerb "Directory\\Background"')
    expect(script).toContain('!insertmacro ElenaWriteVerb "Drive"')
  })

  it('agrees with the app on the label, the argv contract and the stamp', () => {
    const nsisExe = '$INSTDIR\\${APP_EXECUTABLE_FILENAME}'
    expect(script).toContain(`"${CONTEXT_MENU_LABEL}"`)
    expect(script).toContain(contextMenuCommand(nsisExe))
    // A stamp the app does not recognise means every launch rewrites the verb.
    expect(script).toContain(`"${CONTEXT_MENU_STATE_VALUE}" '${contextMenuState(nsisExe)}'`)
    // And it has to be the last write, for the same reason it is in the app.
    const stampAt = script.indexOf(`"${CONTEXT_MENU_STATE_VALUE}"`)
    expect(stampAt).toBeGreaterThan(script.indexOf(contextMenuCommand(nsisExe)))
  })

  it('is referenced by the packaging config, or it never runs', () => {
    const builder = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8')
    expect(builder).toContain('include: build/installer.nsh')
  })
})
