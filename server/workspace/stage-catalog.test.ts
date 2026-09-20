import { expect, test } from 'vitest'
import { FLOW_PROFILES, STAGES, stageFor, stageOwnedFiles } from './stage-catalog'

test('keeps the stage catalog and flow transitions aligned', () => {
  expect(stageFor('planejando')).toBe(STAGES[0])
  expect(FLOW_PROFILES.simples.next['task-planning']).toBe('desenvolvendo')
  expect(stageOwnedFiles(STAGES[0])).toEqual(['PLAN.md', 'TASK-CHECKLIST.md', 'TEST-CHECKLIST.md'])
})
