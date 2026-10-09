import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { captureStageSnapshot, restoreStageSnapshot } from './stage-snapshot'

test('restores only artifacts owned by a stage', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-snapshot-'))
  const plan = join(root, 'PLAN.md')
  const unrelated = join(root, 'notes.md')
  writeFileSync(plan, 'plano original')
  writeFileSync(unrelated, 'preservar')

  captureStageSnapshot(root, 'task-planning', ['PLAN.md', 'TASK-CHECKLIST.md'])
  writeFileSync(plan, 'plano alterado')
  writeFileSync(join(root, 'TASK-CHECKLIST.md'), 'nova checklist')

  restoreStageSnapshot(root, 'task-planning')

  expect(readFileSync(plan, 'utf8')).toBe('plano original')
  expect(existsSync(join(root, 'TASK-CHECKLIST.md'))).toBe(false)
  expect(readFileSync(unrelated, 'utf8')).toBe('preservar')
})
