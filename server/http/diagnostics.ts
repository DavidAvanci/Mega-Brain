import type { IncomingMessage, ServerResponse } from 'node:http'

/** Protocol consumed by the desktop supervisor, independent of app version. */
export const BACKEND_READY_PROTOCOL_VERSION = 1
/** Version of authenticated loopback diagnostics. */
export const BACKEND_API_PROTOCOL_VERSION = 1

export type ListenerState = 'starting' | 'ready' | 'stopping' | 'stopped'

export type BackendReadiness =
  { status: 'ready' } | { status: 'starting'; reason: string } | { status: 'degraded'; reason: string }

export type BackendReadinessProbe = () => BackendReadiness

export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (!response.hasHeader('Content-Type')) response.setHeader('Content-Type', 'application/json')
  response.statusCode = status
  response.end(JSON.stringify(body))
}

export function writeDiagnosticEndpoint(
  request: IncomingMessage,
  response: ServerResponse,
  path: '/health' | '/version',
  diagnostics: { listenerState: ListenerState; readiness?: BackendReadinessProbe; runtimeVersion: string },
): void {
  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    response.setHeader('Allow', 'GET')
    writeJson(response, 405, { error: 'Método não permitido' })
    return
  }
  const readiness = currentReadiness(diagnostics.listenerState, diagnostics.readiness)
  if (path === '/version') {
    writeJson(response, 200, {
      service: 'mega-brain-backend',
      apiProtocolVersion: BACKEND_API_PROTOCOL_VERSION,
      readyProtocolVersion: BACKEND_READY_PROTOCOL_VERSION,
      runtime: { name: 'node', version: diagnostics.runtimeVersion },
    })
    return
  }
  writeJson(response, readiness.status === 'ready' ? 200 : 503, {
    service: 'mega-brain-backend',
    apiProtocolVersion: BACKEND_API_PROTOCOL_VERSION,
    status: readiness.status,
    ...(readiness.status === 'ready' ? {} : { reason: readiness.reason }),
  })
}

export function currentReadiness(
  listenerState: ListenerState,
  probe: BackendReadinessProbe | undefined,
): BackendReadiness {
  if (listenerState === 'starting') return { status: 'starting', reason: 'listener-starting' }
  if (listenerState === 'stopping' || listenerState === 'stopped')
    return { status: 'degraded', reason: 'listener-stopping' }
  try {
    return probe?.() ?? { status: 'ready' }
  } catch {
    return { status: 'degraded', reason: 'runtime-status-unavailable' }
  }
}
