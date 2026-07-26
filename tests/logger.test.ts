import { describe, expect, it } from 'vitest'
import { sanitizeLogMeta } from '../src/main/logger'

describe('log redaction', () => {
  it('redacts sensitive fields recursively', () => {
    expect(
      sanitizeLogMeta({
        apiKey: 'sk-project-secretvalue',
        nested: { authorization: 'Bearer abcdefghijk', safe: 'metadata' }
      })
    ).toEqual({ apiKey: '[REDACTED]', nested: { authorization: '[REDACTED]', safe: 'metadata' } })
  })

  it('redacts token-like values embedded in error messages', () => {
    const result = sanitizeLogMeta({
      message: 'request failed Authorization=ignored OPENAI_API_KEY=very-secret-value Bearer abcdefghijk'
    })
    expect(result.message).not.toContain('very-secret-value')
    expect(result.message).not.toContain('abcdefghijk')
  })

  it('flattens newlines and caps oversized fields', () => {
    const result = sanitizeLogMeta({ message: `line one\n${'x'.repeat(600)}` })
    expect(String(result.message)).not.toContain('\n')
    expect(String(result.message).length).toBeLessThanOrEqual(501)
  })
})
