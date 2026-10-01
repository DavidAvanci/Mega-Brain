import type { CardTriageResult } from '../../shared/domain/card-triage'
import type { FlowLevel } from '../../shared/domain/cards'
import type { JevEvaluation } from '../integrations/jev/types'
import { POLICY_VERSION } from './policy-config'

export function decideTriage({ answers, modelVersion }: JevEvaluation): CardTriageResult {
  const answer = answers.difficulty
  const probabilities = {
    simples: answer.probabilities.simples,
    medio: answer.probabilities.medio,
    dificil: answer.probabilities.dificil,
  }
  const suggestedFlow = (['simples', 'medio', 'dificil'] as const).reduce((best, flow) =>
    probabilities[flow] > probabilities[best] ? flow : best,
  )
  return {
    status: 'suggested',
    suggestedFlow: suggestedFlow as FlowLevel,
    probabilities,
    modelVersion,
    policyVersion: POLICY_VERSION,
  }
}
