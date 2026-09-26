import { describe, expect, test, vi } from 'vitest'
import { loadMegaBrainConfig } from '../config'
import { createLayaClient } from '../integrations/laya/client'
import { LayaFailure, type LayaEvaluation } from '../integrations/laya/types'
import { decideTriage } from './policy'
import { createCardTriageService, validateTriageInput } from './service'
import { cardTriageHttp } from './http'
import { createProductionRouteTable } from '../production-routes'

function evaluation(
  choice: 'simples' | 'medio' | 'dificil' = 'simples',
  probabilities: Record<'simples' | 'medio' | 'dificil', number> = {
    simples: choice === 'simples' ? 1 : 0,
    medio: choice === 'medio' ? 1 : 0,
    dificil: choice === 'dificil' ? 1 : 0,
  },
): LayaEvaluation {
  return {
    modelVersion: 'laya:multilingual',
    answers: { difficulty: { choice, confidence: 0.55, probabilities } },
    usage: { input_tokens: 10, output_tokens: 2 },
  }
}

describe('triage policy', () => {
  test('uses the single Laya choice directly and returns all three probabilities', () => {
    for (const flow of ['simples', 'medio', 'dificil'] as const) {
      const result = decideTriage(evaluation(flow))
      expect(result).toMatchObject({ status: 'suggested', suggestedFlow: flow })
    }
    expect(decideTriage(evaluation('medio', { simples: 0.2, medio: 0.6, dificil: 0.2 }))).toMatchObject({
      status: 'suggested',
      suggestedFlow: 'medio',
      probabilities: { simples: 0.2, medio: 0.6, dificil: 0.2 },
    })
  })
})

describe('Laya adapter', () => {
  test('sends only state and versioned questions, validates the answer', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://192.168.0.66:3000/v1/systemone')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private')
      expect(new Headers(init?.headers).has('Origin')).toBe(false)
      const body = JSON.parse(String(init?.body))
      expect(body.state).toEqual({ title: 'Título', description: 'Descrição' })
      expect(body.model).toBe('auto')
      expect(Object.keys(body.questions)).toEqual(['difficulty'])
      expect(Object.keys(body.questions.difficulty.criteria)).toEqual(['simples', 'medio', 'dificil'])
      const data = evaluation()
      return new Response(
        JSON.stringify({
          model: 'laya-rl-agent',
          routing: { model: 'multilingual' },
          ...data,
          answers: Object.fromEntries(
            Object.entries(data.answers).map(([id, answer]) => [id, { type: 'choice', ...answer }]),
          ),
        }),
        { status: 200, headers: { 'x-laya-gateway-ms': '42' } },
      )
    }) as typeof fetch
    const result = await createLayaClient(fetcher)(
      { title: 'Título', description: 'Descrição' },
      'private',
      'http://192.168.0.66:3000',
    )
    expect(result.answers.difficulty.choice).toBe('simples')
    expect(result.modelVersion).toBe('laya:multilingual')
    expect(result.gatewayMs).toBe(42)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test('rejects an unknown checkpoint and incomplete Choice distribution', async () => {
    const data = evaluation()
    const answer = Object.fromEntries(
      Object.entries(data.answers).map(([id, item]) => [id, { type: 'choice', ...item }]),
    )
    const unknown = createLayaClient(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ routing: { model: 'unknown' }, answers: answer, usage: data.usage }), {
            status: 200,
          }),
      ) as typeof fetch,
    )
    await expect(unknown({ title: 'a', description: '' }, 'private', 'http://192.168.0.66:3000')).rejects.toMatchObject(
      { code: 'external_error' },
    )
    const incomplete = {
      ...answer,
      difficulty: { type: 'choice', choice: 'simples', confidence: 0.9, probabilities: { simples: 1 } },
    }
    const malformed = createLayaClient(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ routing: { model: 'english' }, answers: incomplete, usage: data.usage }), {
            status: 200,
          }),
      ) as typeof fetch,
    )
    await expect(
      malformed({ title: 'a', description: '' }, 'private', 'http://192.168.0.66:3000'),
    ).rejects.toMatchObject({ code: 'external_error' })
  })
  test('preserves Retry-After without exposing provider body', async () => {
    const limited = createLayaClient(
      vi.fn(
        async () => new Response('private provider error', { status: 429, headers: { 'retry-after': '5' } }),
      ) as typeof fetch,
    )
    await expect(limited({ title: 'a', description: '' }, 'private', 'http://192.168.0.66:3000')).rejects.toMatchObject(
      {
        code: 'rate_limited',
        retryAfter: 5,
      },
    )
  })
  test.each([
    [403, 'external_error'],
    [502, 'external_error'],
    [503, 'busy'],
    [504, 'timeout'],
    [413, 'external_error'],
  ])('maps gateway HTTP %i to %s', async (status, code) => {
    const client = createLayaClient(vi.fn(async () => new Response('private error', { status })) as typeof fetch)
    await expect(client({ title: 'a', description: '' }, 'private', 'http://192.168.0.66:3000')).rejects.toMatchObject({
      code,
    })
  })
  test('sanitizes authentication and malformed responses', async () => {
    const unauthorized = createLayaClient(vi.fn(async () => new Response('secret', { status: 401 })) as typeof fetch)
    await expect(
      unauthorized({ title: 'a', description: '' }, 'private', 'http://192.168.0.66:3000'),
    ).rejects.toMatchObject({
      code: 'invalid_key',
    })
    const malformed = createLayaClient(vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch)
    await expect(
      malformed({ title: 'a', description: '' }, 'private', 'http://192.168.0.66:3000'),
    ).rejects.toBeInstanceOf(LayaFailure)
  })
})

describe('triage service and route', () => {
  const config = () => {
    const value = loadMegaBrainConfig({ env: {}, homeDir: '/tmp/laya-triage-test' })
    value.laya = { enabled: true, savedKey: 'private', savedBaseUrl: 'http://192.168.0.66:3000' }
    return value
  }
  test('validates limits and returns 400 without consulting Laya', async () => {
    expect(() => validateTriageInput({ title: '', description: '' })).toThrow()
    expect(() => validateTriageInput({ title: 'x'.repeat(501), description: '' })).toThrow()
    expect(() => validateTriageInput({ title: 'x', description: 'x'.repeat(12001) })).toThrow()
    const evaluate = vi.fn(async () => evaluation())
    const handler = cardTriageHttp(createCardTriageService(config(), { evaluate }))
    const response = await handler({
      method: 'POST',
      path: '/api/card-triage',
      query: new URLSearchParams(),
      headers: {},
      body: { title: '', description: '' },
    })
    expect(response.status).toBe(400)
    expect(evaluate).not.toHaveBeenCalled()
  })
  test('logs only metadata, without card content or credential', async () => {
    const value = config()
    const fields: unknown[] = []
    const service = createCardTriageService(value, {
      evaluate: async () => evaluation(),
      logger: { event: (_name, data) => fields.push(data) },
    })
    await service.triage({ title: 'private title', description: 'private description' })
    expect(JSON.stringify(fields)).not.toContain('private title')
    expect(JSON.stringify(fields)).not.toContain('private description')
    expect(JSON.stringify(fields)).not.toContain('private')
    expect(fields).toMatchObject([{ result: 'suggested', cacheHit: false, inputTokens: 10 }])
  })
  test('deduplicates and caches successful requests', async () => {
    const evaluate = vi.fn(async () => ({ ...evaluation(), gatewayMs: 42 }))
    const service = createCardTriageService(config(), { evaluate })
    const input = { title: 'a', description: '' }
    const [a, b] = await Promise.all([service.triage(input), service.triage(input)])
    expect(a).toEqual(b)
    const cached = await service.triage(input)
    expect(a.evidence).toMatchObject({ source: 'gateway', gatewayMs: 42 })
    expect(cached.evidence).toMatchObject({ source: 'cache', analysisId: a.evidence?.analysisId })
    expect(evaluate).toHaveBeenCalledTimes(1)
  })
  test('limits concurrent calls and invalidates cache after a credential change', async () => {
    const value = config()
    let release!: () => void
    const pending = new Promise<LayaEvaluation>((resolve) => {
      release = () => resolve(evaluation())
    })
    const evaluate = vi.fn(async () => pending)
    const service = createCardTriageService(value, { evaluate })
    const one = service.triage({ title: 'one', description: '' })
    const two = service.triage({ title: 'two', description: '' })
    expect((await service.triage({ title: 'three', description: '' })).status).toBe('unavailable')
    release()
    await Promise.all([one, two])
    value.laya.savedKey = 'next-key'
    await service.triage({ title: 'one', description: '' })
    expect(evaluate).toHaveBeenCalledTimes(2)
    value.laya.savedBaseUrl = 'http://192.168.0.67:3000'
    await service.triage({ title: 'one', description: '' })
    expect(evaluate).toHaveBeenCalledTimes(3)
    value.laya.enabled = false
    await service.triage({ title: 'one', description: '' })
    value.laya.enabled = true
    await service.triage({ title: 'one', description: '' })
    expect(evaluate).toHaveBeenCalledTimes(4)
  })
  test('production route returns a domain result and rejects the wrong method', async () => {
    const routes = createProductionRouteTable({ config: config() })
    const request = { path: '/api/card-triage', query: new URLSearchParams(), headers: {} }
    const get = routes.get('GET /api/card-triage')
    const post = routes.get('POST /api/card-triage')
    if (!get || !post || !('length' in get)) throw new Error('Missing route')
    expect((await get({ ...request, method: 'GET' })).status).toBe(405)
    const disabled = config()
    disabled.laya.enabled = false
    const disabledPost = createProductionRouteTable({ config: disabled }).get('POST /api/card-triage')
    if (!disabledPost) throw new Error('Missing route')
    expect(await disabledPost({ ...request, method: 'POST', body: { title: 'A', description: '' } })).toMatchObject({
      body: { status: 'unavailable', reasonCode: 'disabled' },
    })
  })
  test('disabled mode does not call the model', async () => {
    const value = config()
    value.laya.enabled = false
    const evaluate = vi.fn(async () => evaluation())
    expect((await createCardTriageService(value, { evaluate }).triage({ title: 'a', description: '' })).status).toBe(
      'unavailable',
    )
    expect(evaluate).not.toHaveBeenCalled()
  })
})
