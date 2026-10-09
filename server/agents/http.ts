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
    if (body.codexProfileId !== undefined && typeof body.codexProfileId !== 'string')
      throw new Error('Perfil Codex inválido')
    service.stop(body.id, typeof body.codexProfileId === 'string' ? body.codexProfileId : undefined)
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true },
    }
  })
