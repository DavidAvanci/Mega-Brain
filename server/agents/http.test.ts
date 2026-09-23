import { expect, test } from 'vitest'
import type { ApiRequest } from '../contracts'
import { agentsHttp } from './http'

const request = (method: string, path: string, body?: unknown): ApiRequest => ({
  method,
  path,
  body,
  query: new URLSearchParams(),
  headers: {},
})

test('lists sessions and forwards a stop request to the agent service', async () => {
  const stopped: string[] = []
  const service = {
    list: () => ({ sessions: [], scannedAt: '2026-09-21T12:00:00.000Z' }),
    stop: (id: string) => stopped.push(id),
  }
  const handler = agentsHttp(service)

  await expect(handler(request('GET', '/api/agents'))).resolves.toMatchObject({
    status: 200,
    body: { sessions: [] },
  })
  await expect(handler(request('POST', '/api/agents/stop', { id: 'claude-123' }))).resolves.toMatchObject({
    status: 200,
    body: { ok: true },
  })
  expect(stopped).toEqual(['claude-123'])
})

test('rejects malformed stop requests without touching a process', async () => {
  const stopped: string[] = []
  const handler = agentsHttp({
    list: () => ({ sessions: [], scannedAt: '2026-09-21T12:00:00.000Z' }),
    stop: (id: string) => stopped.push(id),
  })

  await expect(handler(request('POST', '/api/agents/stop', { id: '' }))).resolves.toMatchObject({
    status: 500,
    body: { error: 'Requisição de agente inválida' },
  })
  expect(stopped).toEqual([])
})
