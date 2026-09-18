import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  blockedByDeps,
  markItem,
  matchesPattern,
  overlaps,
  parseChecklist,
  ready,
  resetUnfinished,
  stripMeta,
  widenFiles,
} from './checklist'

const MD = `# TASK-CHECKLIST

## api-garcom-digital
- [ ] T1 Criar migration {files: src/database/migrations/*; deps: -}
- [ ] T2 Expor campo no serializer {files: src/app/serializers/Order.js; deps: T1}

## operation-takeat
- [x] T3 Congelar restante {files: src/pages/Split/*}
- [ ] T4 Exibir parcelas {files: src/pages/Split/Summary.tsx; deps: T3}
- [ ] T5 Ajustar rotas {files: src/routes.tsx, src/pages/Split/*}
`

test('parseChecklist', () => {
  const items = parseChecklist(MD)
  expect(items).toHaveLength(5)
  expect(items[0]).toMatchObject({ id: 'T1', repo: 'api-garcom-digital', deps: [], state: 'pending' })
  expect(items[0].files).toEqual(['src/database/migrations/*'])
  expect(items[1].deps).toEqual(['T1'])
  expect(items[2]).toMatchObject({ id: 'T3', repo: 'operation-takeat', state: 'done' })
  expect(items[4].files).toEqual(['src/routes.tsx', 'src/pages/Split/*'])
  expect(items[0].text).toBe('Criar migration')
})

test('parseChecklist without ids or metadata', () => {
  const items = parseChecklist('## repo-x\n- [ ] Fazer algo\n- [!] Outra coisa\n')
  expect(items[0]).toMatchObject({ id: '#1', explicitId: false, repo: 'repo-x', files: [], deps: [] })
  expect(items[1].state).toBe('failed')
})

test('app metadata overrides heading repo', () => {
  const items = parseChecklist('- [ ] S1 Testar fluxo {app: operation-takeat}')
  expect(items[0].repo).toBe('operation-takeat')
})

test('stripMeta', () => {
  expect(stripMeta('Fazer X {files: a; deps: -}')).toBe('Fazer X')
  expect(stripMeta('Sem meta')).toBe('Sem meta')
})

test('matchesPattern', () => {
  expect(matchesPattern('src/pages/Split/Summary.tsx', 'src/pages/Split/*')).toBe(true)
  expect(matchesPattern('src/pages/Split/deep/file.ts', 'src/pages/Split/*')).toBe(true)
  expect(matchesPattern('src/routes.tsx', 'src/routes.tsx')).toBe(true)
  expect(matchesPattern('src/other.tsx', 'src/pages/Split/*')).toBe(false)
  expect(matchesPattern('src/database/migrations/001.js', 'src/database/migrations')).toBe(true)
})

test('overlaps', () => {
  const [t1, t2, , t4, t5] = parseChecklist(MD)
  expect(overlaps(t1, t2)).toBe(false)
  expect(overlaps(t4, t5)).toBe(true)
  expect(overlaps(t1, t4)).toBe(false)
  const noMeta = parseChecklist('## api-garcom-digital\n- [ ] T9 Sem files')[0]
  expect(overlaps(t1, noMeta)).toBe(true)
})

test('ready respects deps, running and overlap', () => {
  const items = parseChecklist(MD)
  expect(ready(items, new Set()).map((item) => item.id)).toEqual(['T1', 'T4', 'T5'])
  expect(ready(items, new Set(['T4'])).map((item) => item.id)).toEqual(['T1'])
  expect(ready(items, new Set(['T1'])).map((item) => item.id)).toEqual(['T4', 'T5'])
})

test('blockedByDeps cascades', () => {
  const items = parseChecklist('- [!] T1 Falhou\n- [ ] T2 Depende {deps: T1}\n- [ ] T3 Depende {deps: T2}\n- [ ] T4 Livre')
  const blocked = blockedByDeps(items)
  expect(blocked.get('T2')).toBe('T1')
  expect(blocked.get('T3')).toBe('T2')
  expect(blocked.has('T4')).toBe(false)
})

test('markItem and resetUnfinished', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-'))
  const file = join(dir, 'TASK-CHECKLIST.md')
  writeFileSync(file, MD)
  const items = parseChecklist(MD)
  markItem(file, items[0], 'done')
  markItem(file, items[1], 'failed', 'Observado: erro de lint\nEsperado: build limpo')
  let updated = readFileSync(file, 'utf8')
  expect(updated).toContain('- [x] T1 Criar migration')
  expect(updated).toContain('- [!] T2 Expor campo no serializer')
  expect(updated).toContain('  > Observado: erro de lint')
  expect(parseChecklist(updated).find((item) => item.id === 'T2')?.state).toBe('failed')

  resetUnfinished(file)
  updated = readFileSync(file, 'utf8')
  expect(updated).toContain('- [x] T1')
  expect(updated).toContain('- [ ] T2')
  expect(updated).not.toContain('Observado: erro de lint')
})

test('markItem without explicit id matches by text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-'))
  const file = join(dir, 'x.md')
  writeFileSync(file, '## repo\n- [ ] Fazer algo\n- [ ] Fazer outra\n')
  const items = parseChecklist(readFileSync(file, 'utf8'))
  markItem(file, items[1], 'done')
  expect(readFileSync(file, 'utf8')).toContain('- [x] Fazer outra')
})

test('resetUnfinished keeps scenario sub-bullets, drops only notes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-'))
  const file = join(dir, 'TEST-CHECKLIST.md')
  writeFileSync(
    file,
    ['- [!] S1 Dividir conta {app: operation-takeat}',
     '  > Observado: erro / Esperado: sucesso',
     '  - Dado: mesa aberta',
     '  - Quando: abrir divisão',
     '  - Então: parcelas visíveis',
     '- [ ] S2 Outro cenário'].join('\n'),
  )
  resetUnfinished(file)
  const updated = readFileSync(file, 'utf8')
  expect(updated).toContain('- [ ] S1 Dividir conta')
  expect(updated).not.toContain('Observado: erro')
  expect(updated).toContain('  - Dado: mesa aberta')
  expect(updated).toContain('  - Quando: abrir divisão')
  expect(updated).toContain('  - Então: parcelas visíveis')
})

test('heading com caminho vira nome do repo', () => {
  const items = parseChecklist('## backend/api-garcom-digital\n- [ ] T1 Fazer algo {files: src/x.js}\n')
  expect(items[0].repo).toBe('api-garcom-digital')
})

test('itens e seções riscados não entram no run', () => {
  const items = parseChecklist(
    [
      '## operation-takeat',
      '- [ ] T1 Vivo {files: a.ts}',
      '- [ ] ~~T2 Descartado~~ — não faz sentido {files: b.ts}',
      '  - detalhe do descartado',
      '## ~~descartados~~',
      '- [ ] T3 Também descartado {files: c.ts}',
    ].join('\n'),
  )
  expect(items.map((item) => item.id)).toEqual(['T1'])
  expect(items[0].details).toEqual([])
})

test('widenFiles acrescenta só o que ainda não casa e preserva o estado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-'))
  const file = join(dir, 'TASK-CHECKLIST.md')
  writeFileSync(file, '## repo\n- [!] T1 Apagar ponte {files: src/hook.ts, src/utils/*; deps: T0}\n')
  const item = parseChecklist(readFileSync(file, 'utf8'))[0]
  const added = widenFiles(file, item, ['src/hook.ts', 'src/utils/consts.ts', 'src/vite-env.d.ts'])
  expect(added).toEqual(['src/vite-env.d.ts'])
  const line = readFileSync(file, 'utf8').split('\n')[1]
  expect(line).toBe('- [!] T1 Apagar ponte {files: src/hook.ts, src/utils/*, src/vite-env.d.ts; deps: T0}')
})

test('widenFiles não afrouxa um item sem files declarados', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-'))
  const file = join(dir, 'TASK-CHECKLIST.md')
  writeFileSync(file, '## repo\n- [ ] T1 Sem files {deps: -}\n')
  const item = parseChecklist(readFileSync(file, 'utf8'))[0]
  expect(widenFiles(file, item, ['src/a.ts'])).toEqual([])
  expect(readFileSync(file, 'utf8')).toContain('- [ ] T1 Sem files {deps: -}')
})
