import type { ApiHandler, JsonResponse } from '../contracts'
import { RepositoryDirtyError, type RepositoryRegistry } from './registry'

export function repositoriesHttp(registry: RepositoryRegistry): ApiHandler {
  return async (request) => {
    try {
      const id = request.query.get('id') ?? ''
      if (request.path === '/api/repositories' && request.method === 'GET') return json(200, await registry.list())
      if (request.path === '/api/repositories/preview' && request.method === 'POST') return json(200, await registry.preview(record(request.body).path))
      if (request.path === '/api/repositories/discover' && request.method === 'POST') return json(200, await registry.discover(record(request.body).path))
      if (request.path === '/api/repositories' && request.method === 'POST') return json(201, await registry.create(request.body))
      if (request.path === '/api/repositories' && request.method === 'PATCH') return json(200, await registry.update(id, request.body))
      if (request.path === '/api/repositories/status' && request.method === 'GET') return json(200, await registry.status(id))
      if (request.path === '/api/repositories/switch-master' && request.method === 'POST') {
        const body = record(request.body)
        return json(200, await registry.switchToMaster(body.id, body.dirtyAction, body.commitMessage))
      }
      return json(404, { error: 'Rota não encontrada' })
    } catch (error) {
      if (error instanceof RepositoryDirtyError) return json(409, { error: error.message, requiresDecision: true })
      const message = error instanceof Error ? error.message : String(error)
      return json(message.includes('não encontrado') ? 404 : 400, { error: message })
    }
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function json(status: number, body: unknown): JsonResponse {
  return { status, body, headers: { 'Content-Type': 'application/json' } }
}
