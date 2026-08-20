/**
 * The `--open-folder` argv contract.
 *
 * Windows Explorer's "Open in Elena" verb launches the app with
 * `--open-folder "<path>"`. The same flag is what the installer writes into the
 * registry, what `registerExplorerContextMenu` writes at runtime, and what the
 * `second-instance` handler reads when Elena is already up — so the three must
 * agree on this one string.
 *
 * Deliberately Electron-free and side-effect-free: parsing argv is separable
 * from deciding what to do with the result, and only this half is worth a unit
 * test.
 */
export const OPEN_FOLDER_FLAG = '--open-folder'

/**
 * Returns the raw path following `--open-folder` (space- or `=`-separated), or
 * null when the flag is absent or carries no value.
 *
 * The path is returned verbatim: validation is `validateDirectory`'s job, and
 * doing any of it here would mean two places deciding what a usable folder is.
 */
export function parseOpenFolderArg(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === OPEN_FOLDER_FLAG) {
      const value = argv[index + 1]
      // A following switch is the next argument, not this flag's value.
      if (value === undefined || value.startsWith('--')) return null
      return value.length > 0 ? value : null
    }
    if (arg?.startsWith(`${OPEN_FOLDER_FLAG}=`)) {
      const value = arg.slice(OPEN_FOLDER_FLAG.length + 1)
      return value.length > 0 ? value : null
    }
  }
  return null
}
