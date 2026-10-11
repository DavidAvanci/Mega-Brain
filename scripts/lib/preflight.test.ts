import { expect, test } from 'vitest'
import { checklistItem } from '../../test/checklist-fixtures'
import { preflight, type PreflightDeps } from './preflight'
const allOk: PreflightDeps = { repoExists: () => true, pathExists: () => true }

test('unknown repo is rejected before starting an agent', () => {
  const issues = preflight([checklistItem('T1', { repo: 'api' }), checklistItem('T2', { repo: 'infra' })], {
    ...allOk,
    repoExists: (repo) => repo === 'api',
  })
  expect(issues).toHaveLength(1)
  expect(issues[0].where).toBe('infra')
  expect(issues[0].message).toContain('state=discarded')
})
test('missing dependency, repeated ID and self dependency are reported', () => {
  expect(
    preflight(
      [checklistItem('T1', { deps: ['T9'] }), checklistItem('T2', { deps: ['T2'] }), checklistItem('T1')],
      allOk,
    ).map((issue) => issue.message),
  ).toEqual(['Id repetido em 2 itens', 'deps: T9 não existe no checklist', 'Depende de si mesmo'])
})
test('preserves the cause of an unavailable checkout', () => {
  expect(
    preflight([checklistItem('T1')], {
      ...allOk,
      repoExists: () => false,
      repoIssue: () => 'Checkout não disponível',
    })[0].message,
  ).toBe('Checkout não disponível')
})
test('dependency cycles are reported', () => {
  const items = [
    checklistItem('T1', { deps: ['T3'] }),
    checklistItem('T2', { deps: ['T1'] }),
    checklistItem('T3', { deps: ['T2'] }),
  ]
  expect(preflight(items, allOk)[0].message).toMatch(/^Ciclo em deps: T1 → T3 → T2 → T1$/)
})
test('repo is explicit and mandatory', () => {
  expect(preflight([checklistItem('T1', { repo: '' })], allOk)[0].message).toContain('Sem repo')
})
test('file scope may include files that do not yet exist', () => {
  expect(preflight([checklistItem('T1', { files: ['src/new/x.ts'] })], { ...allOk, pathExists: () => false })).toEqual(
    [],
  )
})
test('missing prerequisites block work while planned new files do not', () => {
  expect(
    preflight([checklistItem('T1', { requires: ['src/base.ts'], creates: ['src/new.ts'] })], {
      ...allOk,
      pathExists: () => false,
    }),
  ).toEqual([
    {
      level: 'error',
      where: 'T1',
      message: 'requires: src/base.ts — requisito obrigatório não existe na base preparada',
    },
  ])
})
test('a transitive dependency in the same repo can create a prerequisite', () => {
  const items = [
    checklistItem('T1', { creates: ['src/new.tsx'] }),
    checklistItem('T2', { deps: ['T1'] }),
    checklistItem('T3', { requires: ['src/new.tsx'], deps: ['T2'] }),
  ]
  expect(preflight(items, { ...allOk, pathExists: () => false })).toEqual([])
})
test('files outside the dependency chain or in other repos cannot satisfy a prerequisite', () => {
  const items = [
    checklistItem('T1', { creates: ['src/new.ts'] }),
    checklistItem('T2', { requires: ['src/new.ts'] }),
    checklistItem('T3', { repo: 'other', requires: ['src/new.ts'], deps: ['T1'] }),
  ]
  expect(preflight(items, { ...allOk, pathExists: () => false }).map((issue) => issue.where)).toEqual(['T2', 'T3'])
})
test('an empty executable set cannot start work', () => {
  expect(preflight([], allOk)[0].message).toContain('Nenhum item executável')
})
