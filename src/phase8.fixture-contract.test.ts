import { afterEach, describe, expect, test } from 'vitest'
import { ApiClient } from './apiClient'
import type { ChatEvent } from './types'
import { createReleaseFixture } from '../server/release-fixture'
import { createServerRuntime } from '../server/runtime'
import type { ApiRequest, JsonResponse, SseResponse } from '../server/contracts'

type FixtureCard = {
  name: string
  path: string
  createdAt: string
  title: string
  description: string
  status: string
  flow: string
}

const token = 'f'.repeat(43)
const settings = {
  planning: { model: 'gpt-5.6', effort: 'medium' },
  development: { model: 'gpt-5.6', effort: 'high' },
}

function json(status: number, body: unknown): JsonResponse {
  return { status, headers: { 'Content-Type': 'application/json' }, body }
}

/**
 * A deliberately in-memory implementation of the card surface.  It proves
 * the frontend transport and standalone HTTP boundary agree on the critical
 * fixture flow, without touching a real workspace or any external service.
 */
function fixtureRuntime() {
  const runtime = createServerRuntime()
  const cards = new Map<string, FixtureCard>()
  let boardSettings = structuredClone(settings)

  runtime.register('GET', '/api/workspace', async () => json(200, [...cards.values()]))
  runtime.register('POST', '/api/workspace', async ({ body }) => {
    const input = body as { title?: unknown; description?: unknown; flow?: unknown }
    const title = String(input.title ?? '').trim()
    if (!title) return json(400, { error: 'title é obrigatório' })
    const name = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const card: FixtureCard = {
      name,
      path: `/fixture/workspace/${name}`,
      createdAt: '2026-09-03T00:00:00.000Z',
      title,
      description: String(input.description ?? ''),
      status: 'a-fazer',
      flow: String(input.flow ?? 'dificil'),
    }
    cards.set(name, card)
    return json(200, { folder: name })
  })
  runtime.register('POST', '/api/workspace/update', async ({ body }) => {
    const input = body as { name?: unknown; status?: unknown }
    const card = cards.get(String(input.name ?? ''))
    if (!card) return json(404, { error: 'card não encontrado' })
    if (input.status !== undefined) card.status = String(input.status)
    return json(200, { ok: true })
  })
  runtime.register('POST', '/api/workspace/delete', async ({ body }) => {
    cards.delete(String((body as { name?: unknown }).name ?? ''))
    return json(200, { ok: true })
  })
  runtime.register('GET', '/api/workspace/detail', async (request) => detail(request, cards))
  runtime.register('GET', '/api/workspace/diff', async (request) => diff(request, cards))
  runtime.register('GET', '/api/workspace/settings', async () => json(200, { stages: boardSettings }))
  runtime.register('POST', '/api/workspace/settings', async ({ body }) => {
    boardSettings = structuredClone((body as { stages: typeof settings }).stages)
    return json(200, { stages: boardSettings })
  })
  runtime.register('GET', '/api/chat', async (request) => json(200, {
    sessionId: `fixture-${request.query.get('name')}`,
    entries: [{ role: 'assistant', text: 'Histórico simulado' }],
    settings: { model: 'gpt-5.6', effort: 'medium' },
  }))
  runtime.register('POST', '/api/chat/send', async (): Promise<SseResponse<ChatEvent>> => ({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    stream: (emit) => {
      emit({ type: 'settings', settings: { model: 'gpt-5.6', effort: 'medium' } })
      emit({ type: 'text', text: 'Resposta simulada' })
      emit({ type: 'done' })
    },
  }))
  return runtime
}

function detail(request: ApiRequest, cards: Map<string, FixtureCard>): JsonResponse {
  const card = cards.get(request.query.get('name') ?? '')
  return card
    ? json(200, { files: { 'card.json': JSON.stringify(card), 'PLAN.md': '# Plano de fixture' } })
    : json(404, { error: 'card não encontrado' })
}

function diff(request: ApiRequest, cards: Map<string, FixtureCard>): JsonResponse {
  return cards.has(request.query.get('name') ?? '')
    ? json(200, { repos: [{ name: 'fixture-repo', diff: 'diff --git a/a.ts b/a.ts\n+fixture\n' }] })
    : json(404, { error: 'card não encontrado' })
}

describe('Fase 8 fixture flow (simulated transport contract, not desktop E2E)', () => {
  const servers: ReturnType<typeof createReleaseFixture>[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()))
  })

  test('lists, creates, moves and deletes a card through ApiClient and the isolated backend', async () => {
    const { client } = await startFixture(servers)
    await expect(client.json('/api/workspace')).resolves.toEqual([])

    await expect(client.json('/api/workspace', { method: 'POST', body: { title: 'Card crítico', description: 'Fixture segura', flow: 'medio' } }))
      .resolves.toEqual({ folder: 'card-cr-tico' })
    await expect(client.json('/api/workspace/update', { method: 'POST', body: { name: 'card-cr-tico', status: 'desenvolvendo' } }))
      .resolves.toEqual({ ok: true })
    await expect(client.json<FixtureCard[]>('/api/workspace')).resolves.toMatchObject([{ name: 'card-cr-tico', status: 'desenvolvendo', flow: 'medio' }])

    await expect(client.json('/api/workspace/delete', { method: 'POST', body: { name: 'card-cr-tico' } })).resolves.toEqual({ ok: true })
    await expect(client.json('/api/workspace')).resolves.toEqual([])
  })

  test('loads fixture detail and diff, streams simulated chat, and persists settings', async () => {
    const { client } = await startFixture(servers)
    await client.json('/api/workspace', { method: 'POST', body: { title: 'Card crítico' } })

    await expect(client.json('/api/workspace/detail?name=card-cr-tico')).resolves.toMatchObject({ files: { 'PLAN.md': '# Plano de fixture' } })
    await expect(client.json('/api/workspace/diff?name=card-cr-tico')).resolves.toMatchObject({ repos: [{ name: 'fixture-repo', diff: expect.stringContaining('diff --git') }] })

    const events: ChatEvent[] = []
    await client.sse('/api/chat/send', { method: 'POST', body: JSON.stringify({ name: 'card-cr-tico', text: 'Olá' }), headers: { 'Content-Type': 'application/json' }, onEvent: (event) => { events.push(event as ChatEvent) } })
    expect(events).toEqual([
      { type: 'settings', settings: { model: 'gpt-5.6', effort: 'medium' } },
      { type: 'text', text: 'Resposta simulada' },
      { type: 'done' },
    ])
    await expect(client.json('/api/chat?name=card-cr-tico')).resolves.toMatchObject({ sessionId: 'fixture-card-cr-tico', entries: [{ text: 'Histórico simulado' }] })

    const changed = { ...settings, development: { model: 'gpt-5.6', effort: 'max' } }
    await expect(client.json('/api/workspace/settings', { method: 'POST', body: { stages: changed } })).resolves.toEqual({ stages: changed })
    await expect(client.json('/api/workspace/settings')).resolves.toEqual({ stages: changed })
  })
})

async function startFixture(servers: ReturnType<typeof createReleaseFixture>[]) {
  const server = createReleaseFixture({ token, runtime: fixtureRuntime() })
  servers.push(server)
  await server.start()
  return { client: new ApiClient({ mode: 'desktop', baseUrl: `http://127.0.0.1:${server.address().port}`, token }) }
}
