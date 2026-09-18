import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { Writable } from 'node:stream'
import { hasValidBearerToken, resolveSessionToken } from './auth'
import { loadMegaBrainConfig, type MegaBrainConfig } from './config'
import { corsResponseHeaders, evaluateCors } from './cors'
import { createServerRuntime, type ServerRuntime } from './runtime'
import type { SseResponse } from './contracts'
import { formatSseEvent } from './chat/http'
import { createProcessOwner, type ProcessOwner } from './process'
import { stderrJsonlLogger, type StructuredLogger } from './logger'

/**
 * Minimal Node HTTP adapter for the transport-neutral server runtime.
 *
 * Route registration remains separate from the listener so each area can be
 * migrated independently and tests can provide a runtime with no real
 * workspace, process, or credential access.
 */
export interface StandaloneServerOptions {
  config: MegaBrainConfig
  runtime?: ServerRuntime
  /** Optional override for tests/dev. Public interfaces are rejected. */
  listen?: {
    host?: string
    port?: number
  }
  /** Test-only injection; production receives the value through the child env. */
  sessionToken?: string
  /**
   * Lets the process owner expose whether the application runtime is usable.
   * A missing probe means the listener itself is ready; extracted services can
   * later supply their own dependency/readiness check without changing HTTP.
   */
  readiness?: BackendReadinessProbe
  /** Test-only runtime metadata injection for the version contract. */
  runtimeVersion?: string
  /** Narrow test/dev override; production uses the conservative defaults below. */
  limits?: Partial<HttpLimits>
  /** stderr-only telemetry; callers may inject a sink in tests. */
  logger?: StructuredLogger
  /** Supervisor-generated execution correlation id (never a credential). */
  sessionId?: string
}

export interface HttpLimits {
  maxBodyBytes: number
  maxHeaderBytes: number
  headersTimeoutMs: number
  bodyIdleTimeoutMs: number
  shortRouteTimeoutMs: number
}

/**
 * JSON is deliberately capped before it reaches domain code.  Chat/stages may
 * run for a long time (and SSE may be quiet), so only ordinary JSON handlers
 * receive a completion deadline; the listener itself has no request timeout.
 */
export const DEFAULT_HTTP_LIMITS: HttpLimits = {
  maxBodyBytes: 1_048_576,
  maxHeaderBytes: 16_384,
  headersTimeoutMs: 15_000,
  bodyIdleTimeoutMs: 15_000,
  shortRouteTimeoutMs: 30_000,
}

export interface StandaloneServer {
  readonly config: MegaBrainConfig
  readonly runtime: ServerRuntime
  readonly httpServer: Server
  /** The actual loopback address, available after start resolves. */
  address(): AddressInfo
  start(): Promise<void>
  stop(): Promise<void>
}

/**
 * Line-oriented protocol consumed by the desktop supervisor.  This is a
 * protocol version, deliberately independent from the application version,
 * so a supervisor can reject a future incompatible child deterministically.
 */
export const BACKEND_READY_PROTOCOL_VERSION = 1
/** Version of authenticated loopback diagnostic payloads and semantics. */
export const BACKEND_API_PROTOCOL_VERSION = 1

export type BackendReadiness =
  | { status: 'ready' }
  | { status: 'starting'; reason: string }
  | { status: 'degraded'; reason: string }

export type BackendReadinessProbe = () => BackendReadiness

type ListenerState = 'starting' | 'ready' | 'stopping' | 'stopped'

export interface BackendLogger {
  info(message: string): void
  error(message: string): void
  event?(name: string, fields?: Record<string, unknown>): void
}

export interface BackendProcessStreams {
  stdout: Pick<Writable, 'write'>
  stderr: Pick<Writable, 'write'>
}

export interface BackendLifecycleOptions {
  createServer?: () => StandaloneServer
  sessionId?: string
  streams?: BackendProcessStreams
  logger?: BackendLogger
  /** Registry shared with chat, stage, dev-env and coffee service factories. */
  processOwner?: ProcessOwner
  shutdownSignals?: SignalEmitter
}

export interface BackendReadyMessage {
  type: 'mega-brain-ready'
  version: typeof BACKEND_READY_PROTOCOL_VERSION
  port: number
  sessionId: string
}

export function createStandaloneServer(options: StandaloneServerOptions): StandaloneServer {
  const runtime = options.runtime ?? createServerRuntime()
  const listenOptions = secureListenOptions(options.config, options.listen)
  const limits = { ...DEFAULT_HTTP_LIMITS, ...options.limits }
  const sessionToken = resolveSessionToken(options.sessionToken ?? process.env.MEGA_BRAIN_SESSION_TOKEN)
  const logger = options.logger
  let listenerState: ListenerState = 'starting'
  const httpServer = createServer({ maxHeaderSize: limits.maxHeaderBytes }, (request, response) => {
    void handleRequest(runtime, request, response, sessionToken, {
      listenerState,
      readiness: options.readiness,
      runtimeVersion: options.runtimeVersion ?? process.versions.node,
      limits,
      logger,
      sessionId: options.sessionId,
    })
  })
  // Node's requestTimeout would terminate legitimate stage/chat streams.  The
  // per-route deadline below applies only after a complete JSON request.
  httpServer.headersTimeout = limits.headersTimeoutMs
  httpServer.requestTimeout = 0
  httpServer.timeout = 0
  httpServer.keepAliveTimeout = 5_000

  return {
    config: options.config,
    runtime,
    httpServer,
    address: () => serverAddress(httpServer),
    start: async () => {
      listenerState = 'starting'
      await listen(httpServer, listenOptions)
      listenerState = 'ready'
    },
    stop: async () => {
      listenerState = 'stopping'
      await close(httpServer)
      listenerState = 'stopped'
    },
  }
}

function secureListenOptions(
  config: MegaBrainConfig,
  override: StandaloneServerOptions['listen'],
): { host: '127.0.0.1'; port: number } {
  if (override?.host !== undefined && override.host !== '127.0.0.1') {
    throw new Error('O backend independente aceita apenas host 127.0.0.1')
  }
  const port = override?.port ?? config.server.port
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('A porta do backend deve estar entre 0 e 65535')
  }
  // Do not allow an option inherited from a dev server to turn this public.
  return { host: '127.0.0.1', port }
}

function serverAddress(server: Server): AddressInfo {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('O backend ainda não está escutando em TCP')
  }
  return address
}

async function handleRequest(
  runtime: ServerRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  sessionToken: string,
  diagnostics: { listenerState: ListenerState; readiness?: BackendReadinessProbe; runtimeVersion: string; limits: HttpLimits; logger?: StructuredLogger; sessionId?: string },
): Promise<void> {
  const requestId = randomBytes(12).toString('base64url')
  const startedAt = Date.now()
  const log = (outcome: string, status: number, extra: Record<string, unknown> = {}) => diagnostics.logger?.event('http.request', {
    requestId, method: request.method ?? 'GET', route: safeRoute(request.url), outcome, status,
    durationMs: Date.now() - startedAt, ...extra,
  })
  const headers = normalizeHeaders(request)
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
  // There is no public handshake route yet. The future supervisor handshake
  // travels over the child stdout pipe, not over loopback HTTP.
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
    const routeTimeout = isLongRunningRoute(request.method, url.pathname) ? undefined : diagnostics.limits.shortRouteTimeoutMs
    const result = await withTimeout(runtime.handle({
      method: request.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers,
      body,
    }), routeTimeout)
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
    // Do not reflect thrown messages; an integration must never be able to
    // expose the session capability through a response or diagnostic error.
    if (error instanceof RequestBodyTooLargeError) writeJson(response, 413, { error: 'Payload muito grande' })
    else if (error instanceof RequestTimeoutError) writeJson(response, 408, { error: 'Tempo de requisição esgotado' })
    else writeJson(response, 400, { error: 'Requisição inválida' })
    diagnostics.logger?.event('http.error', { requestId, method: request.method ?? 'GET', route: safeRoute(request.url), status: response.statusCode, error })
    log('invalid', response.statusCode)
  }
}

function safeRoute(value: string | undefined): string {
  try { return new URL(value ?? '/', 'http://localhost').pathname } catch { return '/' }
}

function isSseResponse(result: Awaited<ReturnType<ServerRuntime['handle']>>): result is SseResponse {
  return Boolean(result && 'stream' in result && typeof result.stream === 'function')
}

/**
 * Writes each domain event immediately.  `flushHeaders` is important here:
 * without it Node is free to buffer the SSE response until the first chunk,
 * which makes a long-running chat look frozen to the WebView.
 */
function writeSse(request: IncomingMessage, response: ServerResponse, result: SseResponse): void {
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  response.statusCode = result.status
  response.flushHeaders()
  let complete = false
  let cancelled = false
  const cancel = () => {
    if (complete || cancelled) return
    cancelled = true
    result.cancel?.()
  }
  const onClose = () => cancel()
  request.once('aborted', cancel)
  response.once('close', onClose)
  const finish = () => {
    if (complete) return
    complete = true
    request.off('aborted', cancel)
    response.off('close', onClose)
    if (!response.writableEnded && !response.destroyed) response.end()
  }
  try {
    result.stream((event: any) => {
      if (complete || cancelled || response.writableEnded || response.destroyed) return
      response.write(formatSseEvent(event))
      if (event?.type === 'done') finish()
    })
  } catch {
    if (!cancelled && !response.writableEnded && !response.destroyed) {
      response.write(formatSseEvent({ type: 'done', error: 'Falha ao transmitir resposta' }))
      finish()
    }
  }
}

function writeDiagnosticEndpoint(
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

function currentReadiness(listenerState: ListenerState, probe: BackendReadinessProbe | undefined): BackendReadiness {
  if (listenerState === 'starting') return { status: 'starting', reason: 'listener-starting' }
  if (listenerState === 'stopping' || listenerState === 'stopped') return { status: 'degraded', reason: 'listener-stopping' }
  try {
    return probe?.() ?? { status: 'ready' }
  } catch {
    // A supervisor needs a deterministic signal, never a thrown internal error.
    return { status: 'degraded', reason: 'runtime-status-unavailable' }
  }
}

function normalizeHeaders(request: IncomingMessage): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [
    name,
    Array.isArray(value) ? value.join(', ') : value,
  ]))
}

class RequestBodyTooLargeError extends Error {}
class RequestTimeoutError extends Error {}

async function readJsonBody(request: IncomingMessage, limits: HttpLimits): Promise<unknown> {
  const declaredLength = request.headers['content-length']
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limits.maxBodyBytes)) {
    request.resume()
    throw new RequestBodyTooLargeError()
  }
  const chunks: Buffer[] = []
  let bytes = 0
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => request.destroy(new RequestTimeoutError()), limits.bodyIdleTimeoutMs)
  }
  resetIdleTimer()
  try {
    for await (const chunk of request) {
      resetIdleTimer()
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += value.length
      if (bytes > limits.maxBodyBytes) {
        request.resume()
        throw new RequestBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

function isLongRunningRoute(method: string | undefined, path: string): boolean {
  return method?.toUpperCase() === 'POST' && (path === '/api/chat/send' || path.endsWith('/stages') || path.includes('/stage/'))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new RequestTimeoutError()), timeoutMs)
    promise.then(resolve, reject).finally(() => { if (timer) clearTimeout(timer) })
  })
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (!response.hasHeader('Content-Type')) response.setHeader('Content-Type', 'application/json')
  response.statusCode = status
  response.end(JSON.stringify(body))
}

function listen(server: Server, options: { host: '127.0.0.1'; port: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

/** Starts the listener and emits precisely one supervisor-ready JSON line. */
export async function startBackendLifecycle(options: BackendLifecycleOptions = {}): Promise<BackendReadyMessage> {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr }
  const logger = options.logger ?? createStderrLogger(streams.stderr)
  const server = options.createServer?.() ?? createStandaloneServer({ config: loadMegaBrainConfig() })
  const sessionId = resolveSessionId(options.sessionId ?? process.env.MEGA_BRAIN_SESSION_ID)
  await server.start()
  const { port } = server.address()
  const ready: BackendReadyMessage = {
    type: 'mega-brain-ready',
    version: BACKEND_READY_PROTOCOL_VERSION,
    port,
    sessionId,
  }
  // stdout is a protocol pipe, never a diagnostic log. Keep this single write
  // so line readers cannot observe interleaved normal application logging.
  streams.stdout.write(`${JSON.stringify(ready)}\n`)
  logger.event?.('backend.ready', { port, sessionId: ready.sessionId })
  logger.info(`Backend pronto em 127.0.0.1:${port} (sessão ${ready.sessionId})`)
  return ready
}

function createStderrLogger(stderr: Pick<Writable, 'write'>, sessionId?: string): BackendLogger {
  const structured = stderrJsonlLogger(stderr, sessionId)
  return {
    info: () => structured.event('backend.info'),
    error: () => structured.event('backend.error'),
    event: structured.event,
  }
}

function resolveSessionId(value: string | undefined): string {
  if (value === undefined) return randomBytes(16).toString('base64url')
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new Error('MEGA_BRAIN_SESSION_ID inválido')
  }
  return value
}

export async function runFromCommandLine(options: BackendLifecycleOptions = {}): Promise<void> {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr }
  const sessionId = resolveSessionId(options.sessionId ?? process.env.MEGA_BRAIN_SESSION_ID)
  const structuredLogger = stderrJsonlLogger(streams.stderr, sessionId)
  const logger = options.logger ?? createStderrLogger(streams.stderr, sessionId)
  const owner = options.processOwner ?? createProcessOwner({
    // Only the process groups created through this registry are targeted.
    signalTree: (pid, signal) => process.kill(-pid, signal),
  })
  const config = loadMegaBrainConfig()
  const server = options.createServer?.() ?? createStandaloneServer({
    config,
    // Compose before listening, with the same registry used by shutdown.
    // Service constructors are intentionally side-effect free.
    runtime: createServerRuntime({ config, processOwner: owner }),
    logger: structuredLogger,
    sessionId,
  })
  let removeShutdownHandlers: (() => void) | undefined
  try {
    await startBackendLifecycle({ ...options, createServer: () => server, processOwner: owner, streams, logger, sessionId })
    removeShutdownHandlers = installShutdownHandlers({
      server,
      owner,
      signals: options.shutdownSignals ?? process,
      logger,
    })
  } catch {
    // Child stderr may be retained by the supervisor. Do not serialize the
    // original exception because its text can originate in user configuration.
    logger.error('Não foi possível iniciar o backend.')
    process.exitCode = 1
  } finally {
    // This only runs on startup failure. On normal operation the handlers stay
    // installed until SIGINT/SIGTERM invokes the idempotent shutdown below.
    if (process.exitCode === 1) removeShutdownHandlers?.()
  }
}

export interface ShutdownHandlerOptions {
  server: StandaloneServer
  owner: ProcessOwner
  signals: SignalEmitter
  logger?: BackendLogger
}

export interface SignalEmitter {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
  off(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
}

/** Install removable, idempotent termination handlers without signalling Node in tests. */
export function installShutdownHandlers(options: ShutdownHandlerOptions): () => void {
  let stopping: Promise<void> | undefined
  let installed = true
  const shutdown = () => {
    if (stopping) return stopping
    stopping = (async () => {
      try {
        options.logger?.event?.('backend.stopping')
        // Stop the acceptor first, then terminate only explicitly owned work.
        await options.server.stop()
        await options.owner.shutdown()
        options.logger?.event?.('backend.stopped')
      } catch {
        options.logger?.error('Falha durante o encerramento do backend.')
        process.exitCode = 1
      } finally {
        remove()
      }
    })()
    return stopping
  }
  const onSignal = () => { void shutdown() }
  const remove = () => {
    if (!installed) return
    installed = false
    options.signals.off('SIGTERM', onSignal)
    options.signals.off('SIGINT', onSignal)
  }
  options.signals.once('SIGTERM', onSignal)
  options.signals.once('SIGINT', onSignal)
  return remove
}

export async function runEmbeddedStageFromCommandLine(stage: string): Promise<void> {
  switch (stage) {
    case 'run-task-checklist':
      await import('../scripts/dev-stage.ts')
      return
    case 'run-test-checklist':
      await import('../scripts/test-stage.ts')
      return
    case 'stage-task':
      await import('../scripts/stage.ts')
      return
    case 'master-pr-task':
      await import('../scripts/master-pr.ts')
      return
    default:
      throw new Error(`Etapa interna desconhecida: ${stage}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const embeddedStage = process.env.MEGA_BRAIN_STAGE_SCRIPT
  if (embeddedStage) {
    void runEmbeddedStageFromCommandLine(embeddedStage).catch(() => {
      process.exitCode = 1
    })
  } else {
    void runFromCommandLine()
  }
}
