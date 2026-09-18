import { describe, expect, it } from 'vitest'
import { contentAddressedRuntimeVersion } from './runtime-version.mjs'

describe('contentAddressedRuntimeVersion', () => {
  it('changes the immutable runtime identity when backend contents change', () => {
    const first = contentAddressedRuntimeVersion('0.1.0', 'a'.repeat(64))
    const second = contentAddressedRuntimeVersion('0.1.0', 'b'.repeat(64))
    expect(first).toBe('0.1.0-aaaaaaaaaaaa')
    expect(second).toBe('0.1.0-bbbbbbbbbbbb')
    expect(second).not.toBe(first)
  })

  it('always respects the desktop manifest limit', () => {
    const version = contentAddressedRuntimeVersion(`1.${'long-version-'.repeat(8)}`, 'c'.repeat(64))
    expect(version).toHaveLength(64)
    expect(version).toMatch(/^[0-9A-Za-z][0-9A-Za-z._-]*$/)
  })
})
