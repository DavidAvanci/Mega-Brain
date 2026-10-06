import { expect, test } from 'vitest'
import { FLOW_PROFILES, STAGES, stageFor, stageOwnedFiles } from './stage-catalog'

test('keeps the stage catalog and flow transitions aligned', () => {
  expect(stageFor('planejando')).toBe(STAGES[0])
  expect(FLOW_PROFILES.simples.next['task-planning']).toBe('desenvolvendo')
  expect(stageOwnedFiles(STAGES[0])).toEqual(['PLAN.md', 'TASK-CHECKLIST.md', 'TEST-CHECKLIST.md'])
})

test('keeps timeout and attempt configuration without imposing turn budgets', () => {
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const prompt = planning.prompt!({ title: 'Alteração ampla', description: '', status: 'planejando', flow: 'dificil' })

  expect(prompt).not.toMatch(/turns/i)
  expect(prompt).toContain('timeoutMin: e attempts:')
  expect(prompt).toContain('Cada item deve ser uma entrega pequena e verificável')
})
