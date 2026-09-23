import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readStageSettings, writeStageSettings } from './stage-settings'

const tempRoot = () => mkdtempSync(join(tmpdir(), 'mega-brain-stage-settings-'))

test('stage settings combine persisted values with safe defaults', () => {
  const root = tempRoot()
  writeFileSync(
    join(root, '.mega-brain-settings.json'),
    JSON.stringify({
      stages: {
        'task-planning': { model: ' opus ', effort: 'max' },
        'run-task-checklist': { model: '', effort: 'invalid' },
      },
    }),
  )

  expect(readStageSettings(root)).toEqual({
    'task-planning': { model: 'opus', effort: 'max' },
    'run-task-checklist': { model: 'fable', effort: 'low' },
    'run-test-checklist': { model: 'sonnet', effort: 'low' },
  })
})

test('stage settings reject invalid writes and persist valid settings', () => {
  const root = tempRoot()
  expect(() => writeStageSettings(root, { 'task-planning': { model: 'opus', effort: 'invalid' } })).toThrow(
    'Effort inválido',
  )

  const settings = writeStageSettings(root, { 'run-test-checklist': { model: 'haiku', effort: 'medium' } })
  expect(settings['run-test-checklist']).toEqual({ model: 'haiku', effort: 'medium' })
  expect(JSON.parse(readFileSync(join(root, '.mega-brain-settings.json'), 'utf8'))).toEqual({ stages: settings })
})
