import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { checklistJson } from '../../test/checklist-fixtures'
import { parseTaskChecklist, TASK_CHECKLIST_FILE } from '../../shared/domain/task-checklist'
import { writeTaskChecklist } from '../../shared/storage/task-checklist'
import {
  appendChecklistRepairs,
  blockedByDeps,
  completedTaskSummary,
  markItem,
  matchesPattern,
  overlaps,
  parseChecklist,
  readChecklist,
  ready,
  resetUnfinished,
  widenFiles,
} from './checklist'

const CHECKLIST = checklistJson([
  { repo: 'sample-api', title: 'Adicionar persistência', files: ['src/db/migrations/*'] },
  { repo: 'sample-api', title: 'Expor atributo', files: ['src/api/item.ts'], deps: ['T1'] },
  { repo: 'sample-web', title: 'Comportamento existente', files: ['src/components/*'], state: 'done' },
  { repo: 'sample-web', title: 'Exibir resultados', files: ['src/components/summary.tsx'], deps: ['T3'] },
  { repo: 'sample-web', title: 'Ajustar rotas', files: ['src/routes/index.ts', 'src/components/*'] },
])

function fixture(json = CHECKLIST) {
  const directory = mkdtempSync(join(tmpdir(), 'cl-'))
  const file = join(directory, TASK_CHECKLIST_FILE)
  writeTaskChecklist(file, parseTaskChecklist(json))
  return { directory, file, read: () => parseTaskChecklist(readFileSync(file, 'utf8')) }
}

test('parses JSON fields and filters discarded items from execution', () => {
  const items = parseChecklist(CHECKLIST)
  expect(items).toHaveLength(5)
  expect(items[0]).toMatchObject({
    id: 'T1',
    repo: 'sample-api',
    files: ['src/db/migrations/*'],
    deps: [],
    state: 'pending',
    title: 'Adicionar persistência',
  })
  expect(items[1].deps).toEqual(['T1'])
  expect(items[2].state).toBe('done')
  expect(parseChecklist(checklistJson([{ state: 'discarded' }, {}])).map((item) => item.id)).toEqual(['T2'])
})

test('preserves prerequisites, created files, limits, context and criteria', () => {
  const [item] = parseChecklist(
    checklistJson([
      {
        requires: ['src/base.ts'],
        creates: ['src/new.ts'],
        timeoutMinutes: 12,
        maxAttempts: 2,
        context: 'Contrato',
        completionCriteria: ['Campo disponível'],
      },
    ]),
  )
  expect(item).toMatchObject({
    requires: ['src/base.ts'],
    creates: ['src/new.ts'],
    timeoutMinutes: 12,
    maxAttempts: 2,
    context: 'Contrato',
    completionCriteria: ['Campo disponível'],
  })
})

test('matches file scope patterns', () => {
  expect(matchesPattern('src/components/summary.tsx', 'src/components/*')).toBe(true)
  expect(matchesPattern('src/components/deep/file.ts', 'src/components/*')).toBe(true)
  expect(matchesPattern('src/routes/index.ts', 'src/routes/index.ts')).toBe(true)
  expect(matchesPattern('src/other.tsx', 'src/components/*')).toBe(false)
  expect(matchesPattern('src/db/migrations/001.js', 'src/db/migrations')).toBe(true)
})

test('whole repo scopes serialize work; disjoint repos and files can run independently', () => {
  const [t1, t2, , t4, t5] = parseChecklist(CHECKLIST)
  expect(overlaps(t1, t2)).toBe(false)
  expect(overlaps(t4, t5)).toBe(true)
  expect(overlaps(t1, t4)).toBe(false)
  expect(overlaps(t1, parseChecklist(checklistJson([{ repo: t1.repo }]))[0])).toBe(true)
})

test('ready respects dependencies, running items and overlap', () => {
  const items = parseChecklist(CHECKLIST)
  expect(ready(items, new Set()).map((item) => item.id)).toEqual(['T1', 'T4', 'T5'])
  expect(ready(items, new Set(['T4'])).map((item) => item.id)).toEqual(['T1'])
  expect(ready(items, new Set(['T1'])).map((item) => item.id)).toEqual(['T4', 'T5'])
})

test('failed dependencies block transitively', () => {
  const items = parseChecklist(checklistJson([{ state: 'failed' }, { deps: ['T1'] }, { deps: ['T2'] }, {}]))
  expect([...blockedByDeps(items)]).toEqual([
    ['T2', 'T1'],
    ['T3', 'T2'],
  ])
})

test('updates by ID and resets failures preserving context, completed and discarded history', () => {
  const f = fixture(
    checklistJson([
      { context: 'Contrato', completionCriteria: ['Entrega'], notes: ['Histórico'] },
      { state: 'discarded', discardReason: 'Substituído', notes: ['Nota antiga'] },
      { state: 'blocked', notes: ['Falhou a base'] },
    ]),
  )
  const items = f.read().items
  markItem(f.file, items[0], 'failed', 'Erro exato\nDetalhe adicional')
  expect(f.read().items[0].notes).toEqual(['Histórico', 'Erro exato\nDetalhe adicional'])
  resetUnfinished(f.file)
  expect(f.read().items[0]).toMatchObject({
    state: 'pending',
    notes: [],
    context: 'Contrato',
    completionCriteria: ['Entrega'],
  })
  expect(f.read().items[1]).toMatchObject({ state: 'discarded', notes: ['Nota antiga'] })
  expect(f.read().items[2]).toMatchObject({ state: 'pending', notes: [] })
  markItem(f.file, items[0], 'done', 'Entregue')
  resetUnfinished(f.file)
  expect(f.read().items[0]).toMatchObject({ state: 'done', notes: ['Entregue'] })
  expect(() => markItem(f.file, items[1], 'done')).toThrow('descartado')
  expect(() => markItem(f.file, { ...items[0], id: 'T99' }, 'done')).toThrow('não encontrado')
})

test('expands uncovered paths without losing previous updates or state', () => {
  const f = fixture(checklistJson([{ files: ['src/hook.ts', 'src/utils/*'], state: 'failed' }]))
  const item = f.read().items[0]
  expect(
    widenFiles(f.file, item, ['src/hook.ts', 'src/utils/consts.ts', 'src/vite-env.d.ts', 'src/vite-env.d.ts']),
  ).toEqual(['src/vite-env.d.ts'])
  expect(f.read().items[0]).toMatchObject({
    files: ['src/hook.ts', 'src/utils/*', 'src/vite-env.d.ts'],
    state: 'failed',
  })
  expect(widenFiles(f.file, item, ['src/another.ts'])).toEqual(['src/another.ts'])
  expect(f.read().items[0].files).toContain('src/vite-env.d.ts')
})

test('does not narrow a whole repo scope', () => {
  const f = fixture(checklistJson([{}]))
  expect(widenFiles(f.file, f.read().items[0], ['src/a.ts'])).toEqual([])
  expect(f.read().items[0].files).toEqual([])
})

test('repair waves retain all task history and allocate IDs beyond discarded repairs', () => {
  const f = fixture(
    checklistJson([{ state: 'done' }, { id: 'VFY1', state: 'discarded', discardReason: 'Substituído' }]),
  )
  expect(
    appendChecklistRepairs(f.file, [
      { repo: 'web', check: 'lint', task: 'Corrigir import', summary: 'Import não utilizado', files: ['src/a.ts'] },
    ]),
  ).toBe(1)
  expect(f.read().items[0].state).toBe('done')
  expect(f.read().items[1].state).toBe('discarded')
  expect(f.read().items[2]).toMatchObject({
    id: 'VFY2',
    repo: 'web',
    state: 'pending',
    files: ['src/a.ts'],
    context: 'Import não utilizado',
  })
  const before = readFileSync(f.file, 'utf8')
  expect(() => appendChecklistRepairs(f.file, [{ repo: 'web', check: 'lint', task: '', summary: 'Erro' }])).toThrow(
    'vazia',
  )
  expect(readFileSync(f.file, 'utf8')).toBe(before)
})

test('PR summaries include only completed executable items and respect repo selection', () => {
  const json = checklistJson([
    { title: 'API pronta', repo: 'api', state: 'done' },
    { title: 'Web pronta', repo: 'web', state: 'done' },
    { title: 'Não entregue', state: 'failed' },
    { title: 'Substituído', state: 'discarded' },
  ])
  expect(completedTaskSummary(json)).toBe('### api\n- API pronta\n\n### web\n- Web pronta')
  expect(completedTaskSummary(json, 'api')).toBe('- API pronta')
  expect(completedTaskSummary(checklistJson([]))).toBe('')
  const f = fixture(json)
  expect(completedTaskSummary(readChecklist(f.directory))).toContain('Web pronta')
  expect(completedTaskSummary(readChecklist(mkdtempSync(join(tmpdir(), 'cl-empty-'))))).toBe('')
})
