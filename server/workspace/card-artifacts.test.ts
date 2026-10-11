import { checklistJson } from "../../test/checklist-fixtures"
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { CARD_FILES, checklistProgress, planningProgress } from './card-artifacts'

test('planning progress follows the selected flow artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-artifacts-'))
  writeFileSync(join(root, 'TASK-CHECKLIST.json'), JSON.stringify({ schemaVersion: 1, items: [{ id: 'T1', title: 'Implementar', repo: 'repo' }] }))

  expect(CARD_FILES).toEqual(['PLAN.md', 'TASK-CHECKLIST.json'])
  expect(planningProgress(root, undefined, 'simples')).toEqual({ done: 1, total: 1, phase: 'Finalizando' })
  expect(planningProgress(root, undefined, 'medio')).toEqual({ done: 1, total: 2, phase: 'Iniciando plano' })
})

test('checklist progress counts completed items and reports the next task', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-checklist-'))
  const progress = checklistProgress()
  expect(progress(root)).toEqual({ done: 0, total: 1, phase: 'Aguardando TASK-CHECKLIST.json' })

  writeFileSync(join(root, 'TASK-CHECKLIST.json'), checklistJson([{"id":"T1","title":"pronta","repo":"repo","state":"done"},{"id":"T2","title":"próxima","repo":"repo"}]))
  expect(progress(root)).toEqual({ done: 1, total: 2, phase: 'próxima' })
})

test('partial planning JSON and discarded-only plans are not considered complete', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-invalid-plan-'))
  const file = join(root, 'TASK-CHECKLIST.json')
  writeFileSync(file, '{')
  expect(planningProgress(root, undefined, 'simples')).toEqual({ done: 0, total: 1, phase: 'Criando tasks' })
  expect(checklistProgress()(root).phase).toContain('Checklist inválida')
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, items: [{ id: 'T1', title: 'Antigo', repo: 'repo', state: 'discarded' }] }))
  expect(planningProgress(root, undefined, 'simples').done).toBe(0)
})
