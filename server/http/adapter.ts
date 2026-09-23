import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hasValidBearerToken } from '../auth'
import type { ServerRuntime } from '../runtime'
import type { StructuredLogger } from '../logger'
import { corsResponseHeaders, evaluateCors } from '../cors'
import { normalizeRequestHeaders, safeRoute } from './request-context'
import {
  type HttpLimits,
  RequestBodyTooLargeError,
  RequestTimeoutError,
  isLongRunningRoute,
  readJsonBody,
  withTimeout,
} from './json-body'
import { isSseResponse, writeSse } from './sse'
import { type BackendReadinessProbe, type ListenerState, writeDiagnosticEndpoint, writeJson } from './diagnostics'

export interface HttpAdapterDiagnostics {
  listenerState: ListenerState
  readiness?: BackendReadinessProbe
  runtimeVersion: string
  limits: HttpLimits
  logger?: StructuredLogger
  /** Correlation id already embedded by the structured logger, when provided. */
  sessionId?: string
}

/**
 * Authenticates and translates a Node request to the transport-neutral runtime.
 * Listener setup and process lifecycle deliberately remain outside this adapter.
 */
export async function handleHttpRequest(
  runtime: ServerRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  sessionToken: string,
  diagnostics: HttpAdapterDiagnostics,
): Promise<void> {
  const requestId = randomBytes(12).toString('base64url')
  const startedAt = Date.now()
  const log = (outcome: string, status: number, extra: Record<string, unknown> = {}) =>
    diagnostics.logger?.event('http.request', {
      requestId,
      method: request.method ?? 'GET',
      route: safeRoute(request.url),
      outcome,
      status,
      durationMs: Date.now() - startedAt,
      ...extra,
    })
  const headers = normalizeRequestHeaders(request.headers)
  const cors = evaluateCors(request.method, headers)
  if (cors.kind === 'reject') {
    // Do not reflect an untrusted Origin and do not run a cross-origin request.
    writeJson(response, 403, { error: 'Origem não permitida' })
    log('cors-rejected', 403)
    return
  }
  if (cors.kind !== 'absent') {
    for (const [name, value] of Object.entries(corsResponseHeaders(cors))) response.setHeader(name, value)
  }
  if (cors.kind === 'preflight') {
    response.statusCode = 204
    response.end()
    log('preflight', 204)
    return
  }
  if (!hasValidBearerToken(headers.authorization, sessionToken)) {
    writeJson(response, 401, { error: 'Não autorizado' })
    log('unauthorized', 401)
    return
  }
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/health' || url.pathname === '/version') {
    writeDiagnosticEndpoint(request, response, url.pathname, diagnostics)
    log('diagnostic', response.statusCode)
    return
  }
  try {
    const body = await readJsonBody(request, diagnostics.limits)
    const routeTimeout = isLongRunningRoute(request.method, url.pathname)
      ? undefined
      : diagnostics.limits.shortRouteTimeoutMs
    const result = await withTimeout(
      runtime.handle({
        method: request.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers,
        body,
      }),
      routeTimeout,
    )
    if (!result) {
      writeJson(response, 404, { error: 'Rota não encontrada' })
      log('not-found', 404)
      return
    }
    if (isSseResponse(result)) {
      writeSse(request, response, result)
      log('sse-open', result.status)
      return
    }
    for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value)
    writeJson(response, result.status, result.body)
    log('ok', result.status)
  } catch (error) {
    // Do not reflect thrown messages; integrations must not expose capabilities.
    if (error instanceof RequestBodyTooLargeError) writeJson(response, 413, { error: 'Payload muito grande' })
    else if (error instanceof RequestTimeoutError) writeJson(response, 408, { error: 'Tempo de requisição esgotado' })
    else writeJson(response, 400, { error: 'Requisição inválida' })
    diagnostics.logger?.event('http.error', {
      requestId,
      method: request.method ?? 'GET',
      route: safeRoute(request.url),
      status: response.statusCode,
      error,
    })
    log('invalid', response.statusCode)
  }
}
