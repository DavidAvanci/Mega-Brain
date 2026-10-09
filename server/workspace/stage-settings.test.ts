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

test('Codex saves Ultra only on supported models without mutating settings on rejection', () => {
  const root = tempRoot()
  writeStageSettings(root, { 'task-planning': { model: 'gpt-6.1-sol', effort: 'ultra' } }, 'chatgpt')
  const before = readFileSync(join(root, '.mega-brain-settings.json'), 'utf8')
  expect(() =>
    writeStageSettings(root, { 'task-planning': { model: 'gpt-6-luna', effort: 'ultra' } }, 'chatgpt'),
  ).toThrow('não suportado')
  expect(readFileSync(join(root, '.mega-brain-settings.json'), 'utf8')).toBe(before)
  expect(readStageSettings(root, 'chatgpt')['task-planning']).toEqual({ model: 'gpt-6.1-sol', effort: 'ultra' })
  expect(() => writeStageSettings(root, { 'task-planning': { model: 'opus', effort: 'ultra' } })).toThrow(
    'não suportado',
  )
})

test('Codex translates legacy Claude aliases and keeps explicitly pinned Codex models', () => {
  const root = tempRoot()
  writeFileSync(
    join(root, '.mega-brain-settings.json'),
    JSON.stringify({
      stages: {
        'task-planning': { model: 'fable', effort: 'high' },
        'run-task-checklist': { model: 'gpt-5.6-sol', effort: 'xhigh' },
      },
    }),
  )
  expect(readStageSettings(root, 'chatgpt')['task-planning']).toEqual({ model: 'gpt-6.1-sol', effort: 'high' })
  expect(readStageSettings(root, 'chatgpt')['run-task-checklist']).toEqual({ model: 'gpt-5.6-sol', effort: 'xhigh' })
  expect(readStageSettings(root)['task-planning'].model).toBe('fable')
})
