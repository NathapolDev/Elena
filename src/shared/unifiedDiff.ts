export type UnifiedDiffLineKind = 'meta' | 'hunk' | 'addition' | 'deletion' | 'context'

export type UnifiedDiffLine = {
  text: string
  kind: UnifiedDiffLineKind
  oldLine?: number
  newLine?: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Parses display-only line gutters; Git remains the source of the patch text. */
export function parseUnifiedDiff(patch: string): UnifiedDiffLine[] {
  let oldLine: number | undefined
  let newLine: number | undefined

  return patch.split('\n').map((text) => {
    const hunk = text.match(HUNK_HEADER)
    if (hunk) {
      oldLine = Number.parseInt(hunk[1] ?? '0', 10)
      newLine = Number.parseInt(hunk[2] ?? '0', 10)
      return { text, kind: 'hunk' }
    }

    if (oldLine !== undefined && newLine !== undefined) {
      if (text.startsWith('+') && !text.startsWith('+++')) {
        const line = { text, kind: 'addition' as const, newLine }
        newLine += 1
        return line
      }
      if (text.startsWith('-') && !text.startsWith('---')) {
        const line = { text, kind: 'deletion' as const, oldLine }
        oldLine += 1
        return line
      }
      if (text.startsWith(' ')) {
        const line = { text, kind: 'context' as const, oldLine, newLine }
        oldLine += 1
        newLine += 1
        return line
      }
    }

    return { text, kind: 'meta' }
  })
}
