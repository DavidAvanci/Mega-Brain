import { expect, test } from 'vitest'
import { evaluateRows, ruleBaseline, type EvaluationRow } from './card-triage-evaluation'

const version = { modelVersion: 'laya:multilingual', policyVersion: 'test' }
test('reports selective precision, coverage and difficult downgrade counts', () => {
  const rows: EvaluationRow[] = [
    {
      id: '1',
      split: 'test',
      label: 'simples',
      ruleBaseline: 'simples',
      result: {
        ...version,
        status: 'suggested',
        suggestedFlow: 'simples',
        probabilities: { simples: 1, medio: 0, dificil: 0 },
      },
      latencyMs: 10,
      inputTokens: 4,
      outputTokens: 2,
    },
    {
      id: '2',
      split: 'test',
      label: 'dificil',
      ruleBaseline: 'dificil',
      result: {
        ...version,
        status: 'suggested',
        suggestedFlow: 'medio',
        probabilities: { simples: 0, medio: 1, dificil: 0 },
      },
      latencyMs: 20,
      inputTokens: 5,
      outputTokens: 3,
    },
    {
      id: '3',
      split: 'test',
      label: 'medio',
      ruleBaseline: 'medio',
      result: { ...version, status: 'unavailable', reasonCode: 'timeout', retryable: true },
      latencyMs: 30,
      inputTokens: 6,
      outputTokens: 4,
    },
  ]
  const metrics = evaluateRows(rows)
  expect(metrics).toMatchObject({
    total: 3,
    suggestions: 2,
    correct: 1,
    precision: 0.5,
    coverage: 2 / 3,
    difficultAsSimple: 0,
    difficultAsMedium: 1,
    latencyP95Ms: 30,
    inputTokens: 15,
  })
  expect(metrics.confusion.dificil.medio).toBe(1)
  expect(metrics.statuses.unavailable).toBe(1)
  expect(ruleBaseline('Migrar autenticação', '')).toBe('dificil')
})
