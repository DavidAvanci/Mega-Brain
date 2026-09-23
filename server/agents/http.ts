import { legacyJsonHandler, type ApiHandler } from '../contracts'
import type { AgentSessionService } from './service'

export const agentsHttp = (service: AgentSessionService): ApiHandler =>
  legacyJsonHandler(async (request) => {
    if (request.method === 'GET') {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: service.list(),
      }
    }
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {}
    if (request.method !== 'POST' || request.path !== '/api/agents/stop' || typeof body.id !== 'string' || !body.id) {
      throw new Error('Requisição de agente inválida')
    }
    service.stop(body.id)
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true },
    }
  })
