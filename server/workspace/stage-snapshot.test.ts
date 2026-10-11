import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { captureStageSnapshot, restoreStageSnapshot } from './stage-snapshot'
import { checklistJson } from '../../test/checklist-fixtures'
import { readTaskChecklist } from '../../shared/storage/task-checklist'

test('restores only artifacts owned by a stage', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-snapshot-'))
  const plan = join(root, 'PLAN.md')
  const unrelated = join(root, 'notes.md')
  writeFileSync(plan, 'plano original')
  writeFileSync(unrelated, 'preservar')

  captureStageSnapshot(root, 'task-planning', ['PLAN.md', 'TASK-CHECKLIST.json'])
  writeFileSync(plan, 'plano alterado')
  writeFileSync(join(root, 'TASK-CHECKLIST.json'), 'nova checklist')

  restoreStageSnapshot(root, 'task-planning')

  expect(readFileSync(plan, 'utf8')).toBe('plano original')
  expect(existsSync(join(root, 'TASK-CHECKLIST.json'))).toBe(false)
  expect(readFileSync(unrelated, 'utf8')).toBe('preservar')
})

test('restores a pre-migration Markdown snapshot over newer JSON without stale tasks', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-snapshot-'))
  const legacy = join(root, 'TASK-CHECKLIST.md')
  writeFileSync(legacy, '## api\n- [ ] T1 Original\n')
  captureStageSnapshot(root, 'task-planning', ['TASK-CHECKLIST.md'])
  readTaskChecklist(root)
  writeFileSync(join(root, 'TASK-CHECKLIST.json'), checklistJson([{ title: 'Novo planejamento' }]))
  restoreStageSnapshot(root, 'task-planning')
  expect(readTaskChecklist(root)?.items[0]).toMatchObject({ title: 'Original', state: 'pending', repo: 'api' })
  expect(existsSync(legacy)).toBe(false)
  expect(readFileSync(`${legacy}.bak`, 'utf8')).toContain('T1 Original')
})

test('a legacy snapshot without a checklist removes the newly generated JSON on reset', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-snapshot-'))
  captureStageSnapshot(root, 'task-planning', ['TASK-CHECKLIST.md'])
  writeFileSync(join(root, 'TASK-CHECKLIST.json'), checklistJson([{}]))
  restoreStageSnapshot(root, 'task-planning')
  expect(readTaskChecklist(root)).toBeNull()
})
