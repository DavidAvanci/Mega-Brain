import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

test('removes screenshots created after a test-stage snapshot', () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-screenshots-'))
  const screenshots = join(root, 'screenshots')
  mkdirSync(screenshots)
  writeFileSync(join(screenshots, 'before.png'), 'before')
  captureStageSnapshot(root, 'run-test-checklist', ['TEST-CHECKLIST.md'])
  writeFileSync(join(screenshots, 'after.png'), 'after')

  restoreStageSnapshot(root, 'run-test-checklist')

  expect(existsSync(join(screenshots, 'before.png'))).toBe(true)
  expect(existsSync(join(screenshots, 'after.png'))).toBe(false)
})
