import { legacyJsonHandler, type ApiHandler, type SseHandler } from '../../contracts'
import { SSE_HEADERS } from '../../chat/http'
import type { ChatEvent } from '../../../shared/contracts/chat'
import type { DevEnvAgentService } from './dev-env-agent'
import { devEnvCapabilityCard } from './dev-env-capability'
import type { WorkspaceService } from '../../workspace/service'

export const devEnvAgentHistoryHttp = (service: DevEnvAgentService): ApiHandler =>
  legacyJsonHandler(async (request) => ({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: await service.history(request.query.get('name') ?? ''),
  }))

export const devEnvAgentAbortHttp = (service: DevEnvAgentService): ApiHandler =>
  legacyJsonHandler(async (request) => {
    const body = request.body && typeof request.body === 'object' && 'name' in request.body ? request.body : undefined
    return {
      status: 200,
      body: { ok: service.abort(String(body?.name ?? '')) },
      headers: { 'Content-Type': 'application/json' },
    }
  })

export const devEnvAgentSendHttp =
  (service: DevEnvAgentService): SseHandler<ChatEvent> =>
  async (request) => {
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {}
    const name = String(body.name ?? '')
    return {
      status: 200,
      headers: SSE_HEADERS,
      cancel: () => {
        service.abort(name)
      },
      stream(emit) {
        try {
          service.send(name, String(body.text ?? ''), emit, body.configuration, body.selection)
        } catch (error) {
          emit({ type: 'done', error: error instanceof Error ? error.message : String(error) })
        }
      },
    }
  }

export const devEnvAgentControlHttp = (workspace: WorkspaceService): ApiHandler =>
  legacyJsonHandler(async (request) => {
    const name = devEnvCapabilityCard(request.headers['x-mega-dev-env-capability'])
    if (!name)
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Credencial de ambiente inválida' },
      }
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {}
    const paths = new Map([
      ['preview', '/dev-env/preview'],
      ['start', '/dev-env'],
      ['logs', '/dev-env/logs'],
      ['stop', '/dev-env/stop'],
      ['status', '/dev-env'],
    ])
    const path = typeof body.action === 'string' ? paths.get(body.action) : undefined
    if (!path) throw new Error('Ação de ambiente inválida')
    const status = body.action === 'status'
    const result = await workspace.handle(path, status ? 'GET' : 'POST', new URLSearchParams({ name }), {
      name,
      configuration: body.configuration,
      file: body.file,
    })
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: result }
  })
