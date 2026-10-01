import { expect, test } from 'vitest'
import { CARD_TRIAGE_POLICY_VERSION, validateCardTriageResponse } from '../../../../shared/domain/card-triage'

const response = {
  status: 'suggested',
  suggestedFlow: 'medio',
  probabilities: { simples: 0.1, medio: 0.7, dificil: 0.2 },
  modelVersion: 'jev-1.13.0',
  policyVersion: CARD_TRIAGE_POLICY_VERSION,
}

test('accepts a current response with all three probabilities', () => {
  expect(validateCardTriageResponse(response)).toEqual(response)
})

test('reports an outdated backend instead of leaving the result blank', () => {
  expect(() => validateCardTriageResponse({ ...response, policyVersion: 'card-triage-jev-1-experimental' })).toThrow(
    'backend da triagem Jev está desatualizado',
  )
  expect(() => validateCardTriageResponse({ ...response, probabilities: undefined })).toThrow(
    'não contém as porcentagens',
  )
  expect(() => validateCardTriageResponse({ ...response, status: 'uncertain' })).toThrow('não contém as porcentagens')
})
