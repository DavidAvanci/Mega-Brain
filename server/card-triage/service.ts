import { createHash, randomUUID } from 'node:crypto'
import type { CardTriageInput, CardTriageResult, UnavailableReason } from '../../shared/domain/card-triage'
import type { MegaBrainConfig } from '../config'
import type { StructuredLogger } from '../logger'
import { createLayaClient } from '../integrations/laya/client'
import { LayaFailure, type LayaEvaluation } from '../integrations/laya/types'
import { normalizeLayaBaseUrl } from '../integrations/laya/url'
import { decideTriage } from './policy'
import { MODEL_VERSION, POLICY_VERSION } from './policy-config'

export function validateTriageInput(value: unknown): CardTriageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Entrada inválida')
  const input = value as Record<string, unknown>
  if (typeof input.title !== 'string' || typeof input.description !== 'string')
    throw new Error('Título e descrição devem ser texto')
  const title = input.title.trim()
  if (!title || title.length > 500 || input.description.length > 12000)
    throw new Error('Título ou descrição excede os limites permitidos')
  return { title, description: input.description }
}

export function createCardTriageService(
  config: MegaBrainConfig,
  options: {
    evaluate?: (input: CardTriageInput, key: string, baseUrl: string, signal?: AbortSignal) => Promise<LayaEvaluation>
    now?: () => number
    logger?: StructuredLogger
  } = {},
) {
  const evaluate = options.evaluate ?? createLayaClient()
  const now = options.now ?? Date.now
  const cache = new Map<string, { expires: number; result: CardTriageResult }>()
  const inflight = new Map<string, Promise<CardTriageResult>>()
  let active = 0
  let scope = ''
  let retryAfter = 0
  const unavailable = (reasonCode: UnavailableReason): CardTriageResult => ({
    status: 'unavailable',
    reasonCode,
    retryable: !['disabled', 'missing_key', 'missing_url', 'invalid_url', 'invalid_key'].includes(reasonCode),
    modelVersion: MODEL_VERSION,
    policyVersion: POLICY_VERSION,
  })
  async function triage(value: CardTriageInput): Promise<CardTriageResult> {
    const input = validateTriageInput(value)
    const key = config.laya.environmentKey || config.laya.savedKey
    const rawBaseUrl = config.laya.environmentBaseUrl || config.laya.savedBaseUrl
    if (!config.laya.enabled || !key || !rawBaseUrl) {
      cache.clear()
      inflight.clear()
      scope = ''
      retryAfter = 0
      return unavailable(!config.laya.enabled ? 'disabled' : !key ? 'missing_key' : 'missing_url')
    }
    let baseUrl: string
    try {
      baseUrl = normalizeLayaBaseUrl(rawBaseUrl)
    } catch {
      return unavailable('invalid_url')
    }
    const nextScope = createHash('sha256')
      .update(
        [key, baseUrl, config.workspaceDir, String(config.laya.enabled), MODEL_VERSION, POLICY_VERSION].join('\0'),
      )
      .digest('hex')
    if (scope !== nextScope) {
      scope = nextScope
      cache.clear()
      inflight.clear()
      retryAfter = 0
    }
    if (now() < retryAfter) return unavailable('rate_limited')
    const id = createHash('sha256')
      .update(JSON.stringify([input.title.trim(), input.description, nextScope]))
      .digest('hex')
    const hit = cache.get(id)
    if (hit && hit.expires > now()) {
      cache.delete(id)
      cache.set(id, hit)
      options.logger?.event('card_triage', {
        result: hit.result.status,
        modelVersion: hit.result.modelVersion,
        policyVersion: POLICY_VERSION,
        cacheHit: true,
        durationMs: 0,
      })
      return hit.result.evidence ? { ...hit.result, evidence: { ...hit.result.evidence, source: 'cache' } } : hit.result
    }
    cache.delete(id)
    const existing = inflight.get(id)
    if (existing) return existing
    if (active >= 1) return unavailable('busy')
    active++
    const started = now()
    const task = (async () => {
      try {
        const response = await evaluate(input, key, baseUrl)
        const result: CardTriageResult = {
          ...decideTriage(response),
          evidence: {
            analysisId: randomUUID(),
            processedAt: new Date(now()).toISOString(),
            source: 'gateway',
            durationMs: Math.max(0, now() - started),
            ...(response.gatewayMs === undefined ? {} : { gatewayMs: response.gatewayMs }),
          },
        }
        options.logger?.event('card_triage', {
          result: result.status,
          modelVersion: result.modelVersion,
          policyVersion: POLICY_VERSION,
          cacheHit: false,
          durationMs: now() - started,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        })
        if (scope === nextScope && result.status === 'suggested') {
          cache.set(id, { expires: now() + 300000, result })
          if (cache.size > 100) cache.delete(cache.keys().next().value!)
        }
        return result
      } catch (error) {
        const reason = error instanceof LayaFailure ? error.code : 'external_error'
        if (
          scope === nextScope &&
          error instanceof LayaFailure &&
          (error.code === 'rate_limited' || error.code === 'busy') &&
          error.retryAfter
        )
          retryAfter = now() + error.retryAfter * 1000
        options.logger?.event('card_triage', {
          result: 'unavailable',
          reason,
          modelVersion: MODEL_VERSION,
          policyVersion: POLICY_VERSION,
          cacheHit: false,
          durationMs: now() - started,
        })
        return unavailable(reason)
      } finally {
        active--
        inflight.delete(id)
      }
    })()
    inflight.set(id, task)
    return task
  }
  return { triage }
}
