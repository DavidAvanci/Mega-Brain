import { expect, test } from 'vitest'
import { shouldNotifyInput } from './useAttention'

test('notifica input apenas depois de observar o agente trabalhando', () => {
  const base = { status: 'code-review' as const, hasError: false }

  expect(
    shouldNotifyInput(
      { ...base, autonomousStatus: null, autonomousWaiting: false },
      { ...base, autonomousStatus: 'aguardando', autonomousWaiting: true },
    ),
  ).toBe(false)

  expect(
    shouldNotifyInput(
      { ...base, autonomousStatus: 'rodando', autonomousWaiting: false },
      { ...base, autonomousStatus: 'aguardando', autonomousWaiting: true },
    ),
  ).toBe(true)
})
