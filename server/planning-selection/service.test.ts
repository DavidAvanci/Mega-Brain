import { describe, expect, test, vi } from 'vitest'
import { loadMegaBrainConfig } from '../config'
import { createPlanningSelectionService } from './service'
import { FALLBACK_CODEX_CATALOG, type CodexModelCatalog } from '../../shared/domain/codex-models'

const card = { title: 'Planejar migração', description: 'Avaliar alternativas e dependências.', status: 'planejando' }
const saved = { model: 'jev', effort: 'high' as const, fastMode: false }
const catalog: CodexModelCatalog = {
  source: 'codex',
  models: FALLBACK_CODEX_CATALOG.models.filter((model) => ['gpt-6.1-sol', 'gpt-6-luna'].includes(model.id)),
  profileId: 'personal',
}
function config(provider: 'chatgpt' | 'claude' = 'chatgpt') {
  const value = loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-planning-jev-test' })
  value.preferences.llmProvider = provider
  value.jev = { enabled: true, savedKey: 'private-key' }
  return value
}
function answer(choices: string[], selected: string) {
  return {
    type: 'choice',
    choice: selected,
    confidence: 1,
    probabilities: Object.fromEntries(choices.map((choice) => [choice, choice === selected ? 1 : 0])),
  }
}
function fetcher(model = 'gpt-6-luna', effort = 'high') {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body))
    const questions = request.questions
    return new Response(
      JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          planningModel: answer(Object.keys(questions.planningModel.criteria), model),
          planningEffort: answer(Object.keys(questions.planningEffort.criteria), effort),
        },
        usage: { input_tokens: 50, output_tokens: 20 },
      }),
    )
  })
}

describe('independent Jev planning selection', () => {
  test.each(['low', 'high', 'max'])(
    'selects Luna with %s effort using two questions in a single request',
    async (effort) => {
      const fetch = fetcher('gpt-6-luna', effort)
      const result = await createPlanningSelectionService(config(), async () => catalog, fetch)(
        card,
        saved,
        new AbortController().signal,
      )
      expect(result).toMatchObject({
        source: 'jev',
        provider: 'chatgpt',
        settings: { model: 'gpt-6-luna', effort },
        requestedEffort: effort,
        effortAdjusted: false,
        jevModelVersion: 'jev-1.13.0',
        profileId: 'personal',
      })
      const request = JSON.parse(String(fetch.mock.calls[0][1]?.body))
      expect(Object.keys(request.questions)).toEqual(['planningModel', 'planningEffort'])
      expect(request.state).toEqual({ title: card.title, description: card.description })
      expect(Object.keys(request.questions.planningModel.criteria)).toEqual(['gpt-6.1-sol', 'gpt-6-luna'])
      expect(result.answers?.planningEffort.probabilities[effort]).toBe(1)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(result)).not.toContain('private-key')
    },
  )
  test('adjusts only an incompatible effort and retains both independent decisions', async () => {
    const result = await createPlanningSelectionService(config(), async () => catalog, fetcher('gpt-6-luna', 'ultra'))(
      card,
      saved,
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      source: 'jev',
      settings: { model: 'gpt-6-luna', effort: 'medium' },
      requestedEffort: 'ultra',
      effortAdjusted: true,
      answers: { planningEffort: { choice: 'ultra' } },
    })
  })
  test('Claude uses its own model options, independently of Codex', async () => {
    const fetch = fetcher('haiku', 'high')
    const models = vi.fn(async () => catalog)
    const result = await createPlanningSelectionService(config('claude'), models, fetch)(
      card,
      saved,
      new AbortController().signal,
    )
    expect(result.settings).toMatchObject({ model: 'haiku', effort: 'high' })
    expect(models).not.toHaveBeenCalled()
    const request = JSON.parse(String(fetch.mock.calls[0][1]?.body))
    expect(Object.keys(request.questions.planningModel.criteria)).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
    expect(request.questions.planningEffort.criteria).not.toHaveProperty('ultra')
  })
  test.each(['disabled', 'missing_key', 'catalog_unavailable'])(
    'falls back without calling Jev when %s',
    async (reason) => {
      const value = config()
      if (reason === 'disabled') value.jev.enabled = false
      if (reason === 'missing_key') delete value.jev.savedKey
      const fetch = fetcher()
      const result = await createPlanningSelectionService(
        value,
        async () => (reason === 'catalog_unavailable' ? FALLBACK_CODEX_CATALOG : catalog),
        fetch,
      )(card, saved, new AbortController().signal)
      expect(result).toMatchObject({ source: 'fallback', reason, settings: { model: 'gpt-6.1-sol', effort: 'high' } })
      expect(fetch).not.toHaveBeenCalled()
    },
  )
  test.each([401, 429, 504, 529])('falls back on HTTP %i without retaining the provider body', async (status) => {
    const fetch = vi.fn(async () => new Response('private-key provider error', { status }))
    const result = await createPlanningSelectionService(config(), async () => catalog, fetch)(
      card,
      saved,
      new AbortController().signal,
    )
    expect(result).toMatchObject({ source: 'fallback', settings: { model: 'gpt-6.1-sol', effort: 'high' } })
    expect(JSON.stringify(result)).not.toContain('private-key')
  })
  test.each(['unavailable-model', 'incomplete-answer'])('rejects a %s response and uses fallback', async (kind) => {
    const fetch =
      kind === 'unavailable-model'
        ? fetcher('unavailable-model')
        : vi.fn(
            async () =>
              new Response(
                JSON.stringify({ model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }),
              ),
          )
    const result = await createPlanningSelectionService(config(), async () => catalog, fetch)(
      card,
      saved,
      new AbortController().signal,
    )
    expect(result).toMatchObject({ source: 'fallback', reason: 'external_error' })
  })
  test('an aborted selection cannot become a fallback launch', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = fetcher()
    await expect(
      createPlanningSelectionService(config(), async () => catalog, fetch)(card, saved, controller.signal),
    ).rejects.toBeDefined()
    expect(fetch).not.toHaveBeenCalled()
  })
})
