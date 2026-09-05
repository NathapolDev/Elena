import { describe, expect, it } from 'vitest'
import { buildSideBySideDiff, MAX_VISIBLE_DIFF_LINES, parseUnifiedDiff, prepareDiffPreview } from '@shared/unifiedDiff'

describe('unified diff display parser', () => {
  it('hides file headers but preserves sign-prefixed content and newline annotations', () => {
    const preview = prepareDiffPreview('diff --git a/file b/file\nnew file mode 100644\nindex 000..abc\n--- /dev/null\n+++ b/file\n@@ -0,0 +1 @@\n++++\n\\ No newline at end of file\n')
    expect(preview.lines.map((line) => line.text)).toEqual(['@@ -0,0 +1 @@', '++++', '\\ No newline at end of file'])
    expect(preview.truncated).toBe(false)
  })

  it('bounds rendered lines independently of the patch byte limit', () => {
    const preview = prepareDiffPreview(`@@ -0,0 +1,10000 @@\n${'+x\n'.repeat(10000)}`)
    expect(preview.lines).toHaveLength(MAX_VISIBLE_DIFF_LINES)
    expect(preview.truncated).toBe(true)
  })

  it('preserves combined conflict output and unmerged notices', () => {
    const preview = prepareDiffPreview('diff --cc file\nindex abc,def..000\n--- a/file\n+++ b/file\n@@@ -1,1 -1,1 +1,2 @@@\n++<<<<<<< HEAD\n* Unmerged path file')
    expect(preview.lines.map((line) => line.text)).toEqual(['@@@ -1,1 -1,1 +1,2 @@@', '++<<<<<<< HEAD', '* Unmerged path file'])
  })
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

  it('treats repeated signs inside a hunk as content and keeps subsequent gutters correct', () => {
    const lines = parseUnifiedDiff('@@ -1,2 +1,2 @@\n----\n++++\n same')
    expect(lines.slice(1)).toEqual([
      { text: '----', kind: 'deletion', oldLine: 1 },
      { text: '++++', kind: 'addition', newLine: 1 },
      { text: ' same', kind: 'context', oldLine: 2, newLine: 2 }
    ])
  })

  it('resets hunk state before the next file header', () => {
    const lines = parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new\ndiff --git a/next b/next\n--- a/next\n+++ b/next\n@@ -5 +5 @@\n-next\n+updated')
    expect(lines.slice(3, 6).every((line) => line.kind === 'meta')).toBe(true)
    expect(lines.at(-1)).toEqual({ text: '+updated', kind: 'addition', newLine: 5 })
  })
})

describe('side by side diff alignment', () => {
  it('pairs replacements and pads additions without shifting following context', () => {
    const rows = buildSideBySideDiff(parseUnifiedDiff('@@ -1,3 +1,4 @@\n before\n----\n++++\n+extra\n after'))
    expect(rows).toMatchObject([
      { kind: 'hunk' },
      { kind: 'lines', left: { oldLine: 1 }, right: { newLine: 1 } },
      { kind: 'lines', left: { text: '----', oldLine: 2 }, right: { text: '++++', newLine: 2 } },
      { kind: 'lines', left: undefined, right: { text: '+extra', newLine: 3 } },
      { kind: 'lines', left: { oldLine: 3 }, right: { newLine: 4 } }
    ])
  })

  it('keeps deletion-only and addition-only hunks separate', () => {
    const rows = buildSideBySideDiff(parseUnifiedDiff('@@ -1,2 +0,0 @@\n-one\n-two\n@@ -10,0 +9 @@\n+new'))
    expect(rows).toMatchObject([
      { kind: 'hunk' },
      { kind: 'lines', left: { oldLine: 1 }, right: undefined },
      { kind: 'lines', left: { oldLine: 2 }, right: undefined },
      { kind: 'hunk' },
      { kind: 'lines', left: undefined, right: { newLine: 9 } }
    ])
  })

  it('attaches missing-newline annotations to the correct side without breaking a replacement', () => {
    const lines = parseUnifiedDiff('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file')
    const rows = buildSideBySideDiff(lines)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      left: { text: '-old', note: '\\ No newline at end of file' },
      right: { text: '+new', note: '\\ No newline at end of file' }
    })
    expect(lines[1]).not.toHaveProperty('note')
  })

  it('handles an empty patch', () => {
    expect(buildSideBySideDiff([])).toEqual([])
  })
})
