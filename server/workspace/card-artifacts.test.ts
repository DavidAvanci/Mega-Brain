import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { CARD_FILES, checklistProgress, planningProgress } from './card-artifacts'

test('planning progress follows the selected flow artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-artifacts-'))
  writeFileSync(join(root, 'TASK-CHECKLIST.md'), 'tasks')

  expect(CARD_FILES).toEqual(['PLAN.md', 'TASK-CHECKLIST.md', 'TEST-CHECKLIST.md'])
  expect(planningProgress(root, undefined, 'simples')).toEqual({ done: 1, total: 1, phase: 'Finalizando' })
  expect(planningProgress(root, undefined, 'medio')).toEqual({ done: 1, total: 2, phase: 'Criando plano' })
})

test('checklist progress counts completed items and reports the next task', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-checklist-'))
  const progress = checklistProgress('TASK-CHECKLIST.md')
  expect(progress(root)).toEqual({ done: 0, total: 1, phase: 'Aguardando TASK-CHECKLIST.md' })

  writeFileSync(join(root, 'TASK-CHECKLIST.md'), '- [x] pronta\n- [ ] próxima {meta}')
  expect(progress(root)).toEqual({ done: 1, total: 2, phase: 'próxima' })
})
