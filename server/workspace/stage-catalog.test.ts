import { expect, test } from 'vitest'
import { FLOW_PROFILES, STAGES, planningPrompt, stageFor, stageOwnedFiles } from './stage-catalog'

test('keeps the stage catalog and flow transitions aligned', () => {
  expect(stageFor('planejando')).toBe(STAGES[0])
  expect(FLOW_PROFILES.simples.next['task-planning']).toBe('desenvolvendo')
  expect(stageOwnedFiles(STAGES[0])).toEqual(['PLAN.md', 'TASK-CHECKLIST.json'])
})

test('custom planning instructions always receive the authoritative JSON contract', () => {
  const prompt = planningPrompt({ title: 'Alterar API', description: '', status: 'planejando', flow: 'simples' }, 'Instruções antigas personalizadas')
  expect(prompt).toContain('Instruções antigas personalizadas')
  expect(prompt).toContain('Contrato obrigatório da checklist: gere TASK-CHECKLIST.json')
  expect(prompt).toContain('schemaVersion')
  expect(prompt).toContain('completionCriteria')
})

test('keeps timeout and attempt configuration without imposing turn budgets', () => {
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const prompt = planning.prompt!({ title: 'Alteração ampla', description: '', status: 'planejando', flow: 'dificil' })

  expect(prompt).not.toMatch(/turns/i)
  expect(prompt).toContain('timeoutMinutes e maxAttempts')
  expect(prompt).toContain('Cada item deve ser uma entrega pequena e verificável')
})
