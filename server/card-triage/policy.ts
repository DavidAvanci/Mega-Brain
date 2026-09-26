import type { CardTriageResult } from '../../shared/domain/card-triage'
import type { FlowLevel } from '../../shared/domain/cards'
import type { LayaEvaluation } from '../integrations/laya/types'
import { POLICY_VERSION } from './policy-config'

export function decideTriage({ answers, modelVersion }: LayaEvaluation): CardTriageResult {
  const answer = answers.difficulty
  return {
    status: 'suggested',
    suggestedFlow: answer.choice as FlowLevel,
    probabilities: {
      simples: answer.probabilities.simples,
      medio: answer.probabilities.medio,
      dificil: answer.probabilities.dificil,
    },
    modelVersion,
    policyVersion: POLICY_VERSION,
  }
}
