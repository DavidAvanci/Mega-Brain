import { expect, test } from 'vitest'
import { activityVisualState, questionFromInput, questionFromText } from './activity'

test('distinguishes tool operations from test filenames and exposes only explicit public questions', () => {
  expect(activityVisualState('Read: src/service.test.ts')).toBe('reading')
  expect(activityVisualState('apply_patch: src/service.test.ts')).toBe('editing')
  expect(activityVisualState('Bash: npm run test')).toBe('testing')
  expect(activityVisualState('functions.exec_command cat app.ts')).toBe('reading')
  expect(questionFromInput({ questions: [{ question: 'Qual banco usar?' }, { question: 'Qual porta?' }] })).toBe(
    'Qual banco usar?\n\nQual porta?',
  )
  expect(questionFromText('A implementação está pronta.')).toBeUndefined()
  expect(questionFromText('Posso continuar?')).toBe('Posso continuar?')
})
