type LocalFontData = {
  readonly family: string
}

type LocalFontsWindow = Window & {
  queryLocalFonts?: () => Promise<readonly LocalFontData[]>
}

let cachedFamilies: readonly string[] | null = null

/** Must be called from a user gesture because Local Font Access is permission-gated. */
export async function loadInstalledFontFamilies(): Promise<readonly string[]> {
  if (cachedFamilies) return cachedFamilies

  const queryLocalFonts = (window as LocalFontsWindow).queryLocalFonts
  if (!queryLocalFonts) throw new Error('Installed font access is unavailable in this version of Elena.')

  const fonts = await queryLocalFonts.call(window)
  const families = new Set<string>()
  for (const font of fonts) {
    const family = font.family.trim()
    if (family) families.add(family)
  }

  cachedFamilies = [...families].toSorted((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
  )
  return cachedFamilies
}
