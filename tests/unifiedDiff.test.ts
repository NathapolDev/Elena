import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '@shared/unifiedDiff'

describe('unified diff display parser', () => {
  it('tracks old and new line gutters across a hunk', () => {
    const lines = parseUnifiedDiff('@@ -2,2 +2,3 @@\n same\n-old\n+new\n+extra')

    expect(lines).toEqual([
      { text: '@@ -2,2 +2,3 @@', kind: 'hunk' },
      { text: ' same', kind: 'context', oldLine: 2, newLine: 2 },
      { text: '-old', kind: 'deletion', oldLine: 3 },
      { text: '+new', kind: 'addition', newLine: 3 },
      { text: '+extra', kind: 'addition', newLine: 4 }
    ])
  })

  it('keeps file headers and no-newline markers as metadata', () => {
    const lines = parseUnifiedDiff('--- a/file\n+++ b/file\n\\ No newline at end of file')
    expect(lines.every((line) => line.kind === 'meta')).toBe(true)
  })
})
