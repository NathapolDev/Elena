/**
 * IPC payload validation. These are the checks that stand between the renderer
 * and a spawn call, so the negative cases matter more than the positive ones.
 */
import { describe, expect, it } from 'vitest'
import { requestSchemas, workspaceFileSchema, layoutNodeSchema } from '@shared/schemas'

describe('app:info payload', () => {
  const schema = requestSchemas['app:info']

  it('accepts an empty request', () => {
    expect(schema.safeParse(undefined).success).toBe(true)
  })

  it.each([{}, null, '', 0])('rejects a non-empty request: %j', (payload) => {
    expect(schema.safeParse(payload).success).toBe(false)
  })
})

describe('terminal:create payload', () => {
  const schema = requestSchemas['terminal:create']

  it('accepts a well-formed request', () => {
    expect(
      schema.safeParse({ workspaceId: 'w1', terminalId: 't1', cols: 120, rows: 30 }).success
    ).toBe(true)
  })

  it('rejects non-integer geometry', () => {
    expect(schema.safeParse({ workspaceId: 'w1', terminalId: 't1', cols: 1.5, rows: 30 }).success).toBe(
      false
    )
  })

  it('rejects absurd geometry that would allocate a huge buffer', () => {
    expect(
      schema.safeParse({ workspaceId: 'w1', terminalId: 't1', cols: 999_999, rows: 30 }).success
    ).toBe(false)
  })

  it('rejects a missing field', () => {
    expect(schema.safeParse({ workspaceId: 'w1', cols: 80, rows: 24 }).success).toBe(false)
  })
})

describe('preset payload', () => {
  const schema = requestSchemas['preset:create']

  it('allows an unconfigured preset to be persisted', () => {
    expect(
      schema.safeParse({ name: 'Custom Command', executable: '', args: [], defaultCwd: '', envAllowlist: [] }).success
    ).toBe(true)
  })

  it('rejects an env allowlist entry that is not a variable name', () => {
    const result = schema.safeParse({
      name: 'Bad',
      executable: 'node',
      args: [],
      defaultCwd: '',
      envAllowlist: ['API_KEY=secret']
    })
    expect(result.success).toBe(false)
  })

  it('accepts plain variable names', () => {
    const result = schema.safeParse({
      name: 'Good',
      executable: 'node',
      args: ['--version'],
      defaultCwd: '',
      envAllowlist: ['ANTHROPIC_API_KEY']
    })
    expect(result.success).toBe(true)
  })
})

describe('layout schema', () => {
  it('rejects a ratio that would collapse a pane', () => {
    const node = {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.99,
      children: [
        { type: 'terminal', terminalId: 'a' },
        { type: 'terminal', terminalId: 'b' }
      ]
    }
    expect(layoutNodeSchema.safeParse(node).success).toBe(false)
  })

  it('rejects a split with the wrong number of children', () => {
    const node = {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [{ type: 'terminal', terminalId: 'a' }]
    }
    expect(layoutNodeSchema.safeParse(node).success).toBe(false)
  })
})

describe('workspace file schema', () => {
  it('rejects a file whose workspaces are not objects', () => {
    expect(workspaceFileSchema.safeParse({ schemaVersion: 1, workspaces: ['nope'] }).success).toBe(false)
  })

  it('accepts an empty, versioned file', () => {
    expect(workspaceFileSchema.safeParse({ schemaVersion: 1, workspaces: [] }).success).toBe(true)
  })
})

describe('terminal typography settings', () => {
  const schema = requestSchemas['settings:update']

  it('accepts the default and supported typography range', () => {
    expect(
      schema.safeParse({
        terminalFontFamily: null,
        terminalFontSize: 13,
        terminalLineHeight: 1.2
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({
        terminalFontFamily: 'Cascadia Mono',
        terminalFontSize: 48,
        terminalLineHeight: 2
      }).success
    ).toBe(true)
  })

  it.each([
    { terminalFontFamily: '' },
    { terminalFontFamily: 'Bad\nFont' },
    { terminalFontSize: 7 },
    { terminalFontSize: 13.5 },
    { terminalLineHeight: 0.9 },
    { terminalLineHeight: 2.1 }
  ])('rejects unsupported typography: %j', (patch) => {
    expect(schema.safeParse(patch).success).toBe(false)
  })
})
