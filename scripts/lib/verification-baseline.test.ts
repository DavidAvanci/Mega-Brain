import { describe, expect, it } from 'vitest'
import { compareDiagnosticBaseline } from './verification-baseline.ts'

describe('compareDiagnosticBaseline', () => {
  it('subtracts baseline diagnostics as a multiset and detects extra duplicates', () => {
    const item = { repo: 'api', file: 'src/a.ts', rule: 'no-x', message: 'same' }
    expect(compareDiagnosticBaseline([item], [item, item])).toMatchObject({
      status: 'comparable',
      newDiagnostics: [item],
      existingCount: 1,
    })
  })
  it('returns inconclusive when the base is invalid or configuration changed', () => {
    expect(compareDiagnosticBaseline(null, [])).toMatchObject({ status: 'inconclusive' })
    expect(compareDiagnosticBaseline([], [], { configurationMatches: false })).toMatchObject({ status: 'inconclusive' })
  })
  it('maps renamed paths to their baseline identity', () => {
    const old = { repo: 'api', file: 'src/old.ts', rule: 'no-x', message: 'same' }
    const renamed = { ...old, file: 'src/new.ts' }
    expect(
      compareDiagnosticBaseline([old], [renamed], { renamedFiles: [{ from: 'src/old.ts', to: 'src/new.ts' }] }),
    ).toMatchObject({ status: 'comparable', newDiagnostics: [], existingCount: 1 })
  })
})
