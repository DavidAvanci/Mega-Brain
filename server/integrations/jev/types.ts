import type { QuestionId } from '../../card-triage/questions'

export interface ChoiceAnswer {
  choice: string
  confidence: number
  probabilities: Record<string, number>
}
export interface JevEvaluation {
  modelVersion: string
  answers: Record<QuestionId, ChoiceAnswer>
  usage: { input_tokens: number; output_tokens: number }
}
export type JevFailureCode = 'invalid_key' | 'rate_limited' | 'timeout' | 'busy' | 'external_error'
export class JevFailure extends Error {
  constructor(
    readonly code: JevFailureCode,
    readonly retryAfter?: number,
  ) {
    super(code)
  }
}
