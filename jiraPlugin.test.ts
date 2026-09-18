import { expect, test } from 'vitest'
import { matchTransition } from './jiraPlugin'

test('matchTransition', () => {
  const transitions = [
    { id: '11', to: { name: 'Code Review' } },
    { id: '21', to: { name: 'Em Produção' } },
    { id: '31' },
  ]

  expect(matchTransition(transitions, 'EM PRODUÇÃO')?.id).toBe('21')
  expect(matchTransition(transitions, 'em producao')?.id).toBe('21')
  expect(matchTransition(transitions, ' code review ')?.id).toBe('11')
  expect(matchTransition(transitions, 'Concluído')).toBeUndefined()
  expect(matchTransition([], 'EM PRODUÇÃO')).toBeUndefined()
})
