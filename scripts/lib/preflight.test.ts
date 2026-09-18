import { expect, test } from 'vitest'
import { parseChecklist } from './checklist'
import { preflight, type PreflightDeps } from './preflight'

const allOk: PreflightDeps = { repoExists: () => true, pathExists: () => true }

const errors = (md: string, deps: PreflightDeps = allOk) =>
  preflight(parseChecklist(md), deps).filter((issue) => issue.level === 'error')

test('heading que não é repo vira erro antes de gastar agente', () => {
  const deps = { ...allOk, repoExists: (repo: string) => repo === 'api-core' }
  const issues = errors('## api-core\n- [ ] T1 Fazer {files: a.ts}\n## infra (fora de repo)\n- [ ] T2 Outra {files: b.ts}\n', deps)
  expect(issues).toHaveLength(1)
  expect(issues[0].where).toBe('## infra (fora de repo)')
  expect(issues[0].message).toContain('~~infra (fora de repo)~~')
})

test('dep inexistente, id repetido e auto-dependência', () => {
  const issues = errors('## repo\n- [ ] T1 A {deps: T9}\n- [ ] T2 B {deps: T2}\n- [ ] T1 C\n')
  expect(issues.map((issue) => issue.message)).toEqual([
    'Id repetido em 2 itens',
    'deps: T9 não existe no checklist',
    'Depende de si mesmo',
  ])
})

test('ciclo em deps', () => {
  const issues = errors('## repo\n- [ ] T1 A {deps: T3}\n- [ ] T2 B {deps: T1}\n- [ ] T3 C {deps: T2}\n')
  expect(issues[0].message).toMatch(/^Ciclo em deps: T1 → T3 → T2 → T1$/)
})

test('item sem heading de repo', () => {
  expect(errors('- [ ] T1 Solto {files: a.ts}\n')[0].message).toContain('Sem repo')
})

test('path inexistente em files é aviso, não erro', () => {
  const issues = preflight(parseChecklist('## repo\n- [ ] T1 A {files: src/novo/x.ts}\n'), {
    repoExists: () => true,
    pathExists: () => false,
  })
  expect(issues).toEqual([
    { level: 'warn', where: 'T1', message: 'files: src/novo/x.ts — nem o path nem o diretório pai existem' },
  ])
})

test('checklist só com seções descartadas não é executável', () => {
  expect(errors('## ~~descartados~~\n- [ ] T1 Nada {files: a.ts}\n')[0].message).toContain('Nenhum item executável')
})

test('checklist válido não gera nada', () => {
  expect(preflight(parseChecklist('## repo\n- [ ] T1 A {files: a.ts}\n- [ ] T2 B {files: b.ts; deps: T1}\n'), allOk)).toEqual([])
})
