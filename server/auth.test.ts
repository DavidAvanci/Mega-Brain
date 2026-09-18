import { describe, expect, test } from 'vitest'
import { createSessionToken, hasValidBearerToken, resolveSessionToken } from './auth'

describe('standalone API session token', () => {
  test('creates a strong, distinct token for each execution', () => {
    const first = createSessionToken()
    const second = createSessionToken()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).not.toBe(first)
  })

  test('requires the exact Bearer scheme and compares a valid token', () => {
    const token = 'a'.repeat(43)
    expect(hasValidBearerToken(undefined, token)).toBe(false)
    expect(hasValidBearerToken(`bearer ${token}`, token)).toBe(false)
    expect(hasValidBearerToken(`Basic ${token}`, token)).toBe(false)
    expect(hasValidBearerToken(`Bearer ${'b'.repeat(43)}`, token)).toBe(false)
    expect(hasValidBearerToken(`Bearer ${token}`, token)).toBe(true)
  })

  test('accepts only a safe supervisor-injected token', () => {
    expect(resolveSessionToken('a'.repeat(43))).toBe('a'.repeat(43))
    expect(() => resolveSessionToken('short')).toThrow('MEGA_BRAIN_SESSION_TOKEN inválido')
    expect(() => resolveSessionToken(`${'a'.repeat(43)}\n`)).toThrow('MEGA_BRAIN_SESSION_TOKEN inválido')
  })
})
