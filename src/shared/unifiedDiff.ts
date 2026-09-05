export type UnifiedDiffLineKind = 'meta' | 'hunk' | 'addition' | 'deletion' | 'context'

export type UnifiedDiffLine = {
  text: string
  kind: UnifiedDiffLineKind
  oldLine?: number
  newLine?: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export const MAX_VISIBLE_DIFF_LINES = 2000
const GIT_FILE_HEADER = /^(?:diff --(?:git|cc|combined) |index |(?:new file|deleted file|old|new) mode |(?:dis)?similarity index |(?:rename|copy) (?:from|to) |--- |\+\+\+ )/

/** Hide Git transport headers while keeping hunk gutters and newline annotations. */
export function prepareDiffPreview(patch: string): { lines: UnifiedDiffLine[]; truncated: boolean } {
  const lines: UnifiedDiffLine[] = []
  for (const line of iterateUnifiedDiff(patch)) {
    if (line.kind === 'meta' && (!line.text || GIT_FILE_HEADER.test(line.text))) continue
    if (lines.length === MAX_VISIBLE_DIFF_LINES) return { lines, truncated: true }
    lines.push(line)
  }
  return { lines, truncated: false }
}

export type DiffCell = UnifiedDiffLine & { note?: string }
export type SideBySideDiffRow =
  | { kind: 'lines'; left?: DiffCell; right?: DiffCell }
  | { kind: 'meta' | 'hunk'; text: string }

/** Aligns each contiguous replacement block, padding the shorter side with empty cells. */
export function buildSideBySideDiff(lines: readonly UnifiedDiffLine[]): SideBySideDiffRow[] {
  const rows: SideBySideDiffRow[] = []
  let removed: DiffCell[] = []
  let added: DiffCell[] = []
  let previous: DiffCell | undefined
  const flush = (): void => {
    for (let index = 0; index < Math.max(removed.length, added.length); index += 1) {
      rows.push({ kind: 'lines', left: removed[index], right: added[index] })
    }
    removed = []
    added = []
  }

  for (const line of lines) {
    if (line.kind === 'meta' && line.text.startsWith('\\ No newline') && previous) {
      previous.note = line.text
      continue
    }
    const cell: DiffCell = { ...line }
    if (line.kind === 'deletion') {
      removed.push(cell)
    } else if (line.kind === 'addition') {
      added.push(cell)
    } else {
      flush()
      if (line.kind === 'context') {
        rows.push({ kind: 'lines', left: cell, right: cell })
      } else {
        rows.push({ kind: line.kind, text: line.text })
      }
    }
    previous = cell
  }
  flush()
  return rows
}

/** Parses display-only line gutters; Git remains the source of the patch text. */
export function parseUnifiedDiff(patch: string): UnifiedDiffLine[] {
  return Array.from(iterateUnifiedDiff(patch))
}

function* iterateUnifiedDiff(patch: string): Generator<UnifiedDiffLine> {
  let oldLine: number | undefined
  let newLine: number | undefined

  let offset = 0
  while (offset <= patch.length) {
    const end = patch.indexOf('\n', offset)
    const text = patch.slice(offset, end === -1 ? patch.length : end)
    offset = end === -1 ? patch.length + 1 : end + 1
    if (text.startsWith('diff --git ')) {
      oldLine = undefined
      newLine = undefined
      yield { text, kind: 'meta' }
      continue
    }
    const hunk = text.match(HUNK_HEADER)
    if (hunk) {
      oldLine = Number.parseInt(hunk[1] ?? '0', 10)
      newLine = Number.parseInt(hunk[2] ?? '0', 10)
      yield { text, kind: 'hunk' }
      continue
    }

    if (oldLine !== undefined && newLine !== undefined) {
      if (text.startsWith('+')) {
        const line = { text, kind: 'addition' as const, newLine }
        newLine += 1
        yield line
        continue
      }
      if (text.startsWith('-')) {
        const line = { text, kind: 'deletion' as const, oldLine }
        oldLine += 1
        yield line
        continue
      }
      if (text.startsWith(' ')) {
        const line = { text, kind: 'context' as const, oldLine, newLine }
        oldLine += 1
        newLine += 1
        yield line
        continue
      }
    }

    yield { text, kind: 'meta' }
  }
}
