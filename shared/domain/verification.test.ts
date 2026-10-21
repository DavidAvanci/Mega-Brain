import { describe, expect, it } from 'vitest'
import { isRepairableCheck, type VerificationCheck } from './verification.ts'

const base: VerificationCheck = {
  id: 'eslint',
  repo: 'web',
  name: 'eslint',
  status: 'failed',
  cause: 'code',
  summary: 'New diagnostic',
  profileFingerprint: 'profile',
  files: ['src/a.ts'],
  diagnostics: [{ file: 'src/a.ts', rule: 'no-unused-vars', message: 'Unused value' }],
}

describe('isRepairableCheck', () => {
  it('permits only attributed code diagnostics in the card file scope', () => {
    expect(isRepairableCheck(base)).toBe(true)
    expect(isRepairableCheck({ ...base, status: 'environment', cause: 'environment' })).toBe(false)
    expect(isRepairableCheck({ ...base, files: [] })).toBe(false)
    expect(isRepairableCheck({ ...base, diagnostics: [] })).toBe(false)
  })
})
