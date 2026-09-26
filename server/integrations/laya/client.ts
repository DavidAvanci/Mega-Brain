import { REQUESTED_MODEL } from '../../card-triage/policy-config'
import { QUESTIONS, type QuestionId } from '../../card-triage/questions'
import type { CardTriageInput } from '../../../shared/domain/card-triage'
import { LayaFailure, type LayaEvaluation, type ChoiceAnswer } from './types'
import { normalizeLayaBaseUrl } from './url'

const entries = Object.entries(QUESTIONS) as [QuestionId, (typeof QUESTIONS)[QuestionId]][]
const routes = new Set(['english', 'multilingual', 'typed-decisions', 'laya'])
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const probability = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  const delay = Number.isFinite(seconds) ? seconds : (Date.parse(value) - Date.now()) / 1000
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 3600) : undefined
}

export function parseLayaEvaluation(value: unknown): LayaEvaluation {
  if (
    !record(value) ||
    !record(value.answers) ||
    !record(value.usage) ||
    !record(value.routing) ||
    typeof value.routing.model !== 'string' ||
    !routes.has(value.routing.model)
  )
    throw new LayaFailure('external_error')
  const usage = value.usage
  if (
    !Number.isSafeInteger(usage.input_tokens) ||
    !Number.isSafeInteger(usage.output_tokens) ||
    Number(usage.input_tokens) < 0 ||
    Number(usage.output_tokens) < 0
  )
    throw new LayaFailure('external_error')
  const answers = {} as Record<QuestionId, ChoiceAnswer>
  for (const [id, question] of entries) {
    const answer = value.answers[id]
    if (
      !record(answer) ||
      answer.type !== 'choice' ||
      typeof answer.choice !== 'string' ||
      !Object.hasOwn(question.criteria, answer.choice) ||
      !probability(answer.confidence) ||
      !record(answer.probabilities)
    )
      throw new LayaFailure('external_error')
    const options = Object.keys(question.criteria)
    if (
      Object.keys(answer.probabilities).length !== options.length ||
      !options.every((option) => probability((answer.probabilities as Record<string, unknown>)[option]))
    )
      throw new LayaFailure('external_error')
    const probabilities = answer.probabilities as Record<string, number>
    if (
      Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) > 0.01 ||
      probabilities[answer.choice] < Math.max(...Object.values(probabilities))
    )
      throw new LayaFailure('external_error')
    answers[id] = { choice: answer.choice, confidence: answer.confidence, probabilities }
  }
  return {
    modelVersion: `laya:${value.routing.model}`,
    answers,
    usage: { input_tokens: Number(usage.input_tokens), output_tokens: Number(usage.output_tokens) },
  }
}

export function createLayaClient(fetchImpl: typeof fetch = fetch) {
  return async (
    input: CardTriageInput,
    key: string,
    baseUrl: string,
    signal?: AbortSignal,
  ): Promise<LayaEvaluation> => {
    const endpoint = `${normalizeLayaBaseUrl(baseUrl)}/v1/systemone`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) controller.abort()
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: input, model: REQUESTED_MODEL, questions: QUESTIONS }),
        signal: controller.signal,
      })
      if (!response.ok) {
        if (response.status === 401) throw new LayaFailure('invalid_key')
        if (response.status === 429)
          throw new LayaFailure('rate_limited', retryAfterSeconds(response.headers.get('retry-after')))
        if (response.status === 503)
          throw new LayaFailure('busy', retryAfterSeconds(response.headers.get('retry-after')))
        if (response.status === 504) throw new LayaFailure('timeout')
        throw new LayaFailure('external_error')
      }
      const evaluation = parseLayaEvaluation(await response.json())
      const gatewayMs = Number(response.headers.get('x-laya-gateway-ms'))
      if (response.headers.has('x-laya-gateway-ms') && Number.isFinite(gatewayMs) && gatewayMs >= 0)
        evaluation.gatewayMs = gatewayMs
      return evaluation
    } catch (error) {
      if (error instanceof LayaFailure) throw error
      throw new LayaFailure(controller.signal.aborted ? 'timeout' : 'external_error')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}
