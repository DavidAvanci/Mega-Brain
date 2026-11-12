import { REQUESTED_MODEL } from '../../card-triage/policy-config'
import { QUESTIONS } from '../../card-triage/questions'
import type { CardTriageInput } from '../../../shared/domain/card-triage'
import { JevFailure, type JevEvaluation, type ChoiceAnswer, type JevChoiceQuestion } from './types'
import { DEFAULT_JEV_BASE_URL, normalizeJevBaseUrl } from './url'

const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds : (Date.parse(value) - Date.now()) / 1000
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 3600) : undefined
}

export function parseJevEvaluation<Q extends Record<string, JevChoiceQuestion> = typeof QUESTIONS>(
  value: unknown,
  questions: Q = QUESTIONS as unknown as Q,
): JevEvaluation<keyof Q & string> {
  if (
    !record(value) ||
    !record(value.answers) ||
    !record(value.usage) ||
    typeof value.model !== 'string' ||
    !/^jev-\d+\.\d+\.\d+$/.test(value.model)
  )
    throw new JevFailure('external_error')
  const usage = value.usage
  if (
    !Number.isSafeInteger(usage.input_tokens) ||
    !Number.isSafeInteger(usage.output_tokens) ||
    Number(usage.input_tokens) < 0 ||
    Number(usage.output_tokens) < 0
  )
    throw new JevFailure('external_error')
  const answers = {} as Record<keyof Q & string, ChoiceAnswer>
  for (const [id, question] of Object.entries(questions)) {
    const answer = value.answers[id]
    if (
      !record(answer) ||
      answer.type !== 'choice' ||
      typeof answer.choice !== 'string' ||
      !Object.hasOwn(question.criteria, answer.choice) ||
      !probability(answer.confidence) ||
      !record(answer.probabilities)
    )
      throw new JevFailure('external_error')
    const options = Object.keys(question.criteria)
    if (
      Object.keys(answer.probabilities).length !== options.length ||
      !options.every((option) => probability((answer.probabilities as Record<string, unknown>)[option]))
    )
      throw new JevFailure('external_error')
    const probabilities = answer.probabilities as Record<string, number>
    if (
      Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) > 0.01 ||
      probabilities[answer.choice] < Math.max(...Object.values(probabilities))
    )
      throw new JevFailure('external_error')
    answers[id as keyof Q & string] = { choice: answer.choice, confidence: answer.confidence, probabilities }
  }
  return {
    modelVersion: value.model,
    answers,
    usage: { input_tokens: Number(usage.input_tokens), output_tokens: Number(usage.output_tokens) },
  }
}

export function createJevClient<Q extends Record<string, JevChoiceQuestion> = typeof QUESTIONS>(
  fetchImpl: typeof fetch = fetch,
  questions: Q = QUESTIONS as unknown as Q,
) {
  return async (
    input: CardTriageInput,
    key: string,
    baseUrl: string = DEFAULT_JEV_BASE_URL,
    signal?: AbortSignal,
  ): Promise<JevEvaluation<keyof Q & string>> => {
    const endpoint = `${normalizeJevBaseUrl(baseUrl)}/v1/systemone`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: input, model: REQUESTED_MODEL, questions }),
        signal: controller.signal,
      })
      if (!response.ok) {
        if (response.status === 401) throw new JevFailure('invalid_key')
        if (response.status === 429)
          throw new JevFailure('rate_limited', retryAfterSeconds(response.headers.get('retry-after')))
        if (response.status === 503 || response.status === 529)
          throw new JevFailure('busy', retryAfterSeconds(response.headers.get('retry-after')))
        if (response.status === 504) throw new JevFailure('timeout')
        throw new JevFailure('external_error')
      }
      const evaluation = parseJevEvaluation(await response.json(), questions)
      return evaluation
    } catch (error) {
      if (error instanceof JevFailure) throw error
      throw new JevFailure(controller.signal.aborted ? 'timeout' : 'external_error')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
