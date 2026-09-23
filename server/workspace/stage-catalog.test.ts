import { expect, test } from 'vitest'
import { FLOW_PROFILES, STAGES, stageFor, stageOwnedFiles } from './stage-catalog'

test('keeps the stage catalog and flow transitions aligned', () => {
  expect(stageFor('planejando')).toBe(STAGES[0])
  expect(FLOW_PROFILES.simples.next['task-planning']).toBe('desenvolvendo')
  expect(stageOwnedFiles(STAGES[0])).toEqual(['PLAN.md', 'TASK-CHECKLIST.md', 'TEST-CHECKLIST.md'])
})

test('informs the planning agent about executor turn budgets', () => {
  const planning = STAGES.find((stage) => stage.name === 'task-planning')!
  const prompt = planning.prompt!({ title: 'Alteração ampla', description: '', status: 'planejando', flow: 'dificil' })

  expect(prompt).toContain('no máximo 40 turns')
  expect(prompt).toContain('máximo de 60 turns')
  expect(prompt).toContain('Nunca declare turns: acima de 40')
  expect(prompt).toContain('Nunca declare turns: acima de 60')
})
