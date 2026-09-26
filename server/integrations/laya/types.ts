import type { QuestionId } from '../../card-triage/questions'

export interface ChoiceAnswer {
  choice: string
  confidence: number
  probabilities: Record<string, number>
}
export interface LayaEvaluation {
  modelVersion: string
  gatewayMs?: number
  answers: Record<QuestionId, ChoiceAnswer>
  usage: { input_tokens: number; output_tokens: number }
}
export type LayaFailureCode = 'invalid_key' | 'rate_limited' | 'timeout' | 'busy' | 'external_error'
export class LayaFailure extends Error {
  constructor(
    readonly code: LayaFailureCode,
    readonly retryAfter?: number,
  ) {
    super(code)
  }
}
