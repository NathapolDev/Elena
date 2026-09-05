import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { readGitChanges, readGitFileDiff } from '../src/main/git/changes'
import { resolveExecutable } from '../src/main/security/paths'
import { buildSideBySideDiff, MAX_VISIBLE_DIFF_LINES, prepareDiffPreview } from '@shared/unifiedDiff'

it('measures a 1000-file summary and bounded large diff preparation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'elena-diff-perf-'))
  const git = resolveExecutable('git')!
  const lag = monitorEventLoopDelay({ resolution: 10 })
  try {
    execFileSync(git, ['-C', root, 'init'], { stdio: 'ignore' })
    mkdirSync(join(root, 'files'))
    for (let index = 0; index < 1000; index += 1) {
      writeFileSync(join(root, 'files', `${index}.txt`), 'one\ntwo\n')
    }
    lag.enable()
    const start = performance.now()
    const snapshot = await readGitChanges(git, root)
    const summaryMs = performance.now() - start
    expect(snapshot?.summary).toEqual({ additions: 2000, deletions: 0, incomplete: false })
    const diffStart = performance.now()
    const diff = await readGitFileDiff(git, root, 'files/0.txt')
    const diffMs = performance.now() - diffStart
    expect(diff.sections[0]?.patch).toContain('+one')
    const patch = '@@ -0,0 +1,600000 @@\n' + '+x\n'.repeat(600000)
    const parseStart = performance.now()
    const preview = prepareDiffPreview(patch)
    const rows = buildSideBySideDiff(preview.lines)
    const prepareMs = performance.now() - parseStart
    await new Promise((resolve) => setTimeout(resolve, 20))
    lag.disable()
    expect(preview.lines).toHaveLength(MAX_VISIBLE_DIFF_LINES)
    expect(rows.length).toBeLessThanOrEqual(MAX_VISIBLE_DIFF_LINES)
    expect(lag.max / 1e6).toBeLessThan(200)
    process.stdout.write(`diff summary (1000 files) ${summaryMs.toFixed(1)} ms\nfile diff (1000-file repo) ${diffMs.toFixed(1)} ms\npreview preparation (1.8 MB) ${prepareMs.toFixed(1)} ms\ndiff event-loop max ${(lag.max / 1e6).toFixed(1)} ms\nrendered line cap ${preview.lines.length}\n`)
  } finally {
    lag.disable()
    rmSync(root, { recursive: true, force: true })
  }
})
