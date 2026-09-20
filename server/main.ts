import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolveSessionToken } from './auth'
import { loadMegaBrainConfig, type MegaBrainConfig } from './config'
import { createServerRuntime, type ServerRuntime } from './runtime'
import { createProcessOwner } from './process'
import { stderrJsonlLogger, type StructuredLogger } from './logger'
import { DEFAULT_HTTP_LIMITS, type HttpLimits } from './http/json-body'
import { handleHttpRequest } from './http/adapter'
import { type BackendReadinessProbe, type ListenerState } from './http/diagnostics'
import { installShutdownHandlers } from './app/signals'
import { closeListener, listenOnLoopback, secureListenOptions, serverAddress } from './app/listener'
import { runEmbeddedStage } from './app/embedded-stage'
import {
  createStderrLogger,
  resolveSessionId,
  startBackendLifecycle as emitBackendReady,
  type BackendLifecycleOptions,
} from './app/backend-lifecycle'
import type { AddressInfo } from 'node:net'

export {
  DEFAULT_HTTP_LIMITS,
  RequestBodyTooLargeError,
  RequestTimeoutError,
  isLongRunningRoute,
  readJsonBody,
  withTimeout,
} from './http/json-body'
export type { HttpLimits } from './http/json-body'
export { isSseResponse, writeSse } from './http/sse'
export { handleHttpRequest } from './http/adapter'
export type { HttpAdapterDiagnostics } from './http/adapter'
export {
  BACKEND_API_PROTOCOL_VERSION,
  BACKEND_READY_PROTOCOL_VERSION,
  currentReadiness,
  writeDiagnosticEndpoint,
  writeJson,
} from './http/diagnostics'
export type { BackendReadiness, BackendReadinessProbe, ListenerState } from './http/diagnostics'
export { installShutdownHandlers } from './app/signals'
export type { ShutdownHandlerOptions, SignalEmitter } from './app/signals'
export { closeListener, listenOnLoopback, secureListenOptions, serverAddress } from './app/listener'
export type { LoopbackListenOverride } from './app/listener'
export { runEmbeddedStage as runEmbeddedStageFromCommandLine } from './app/embedded-stage'
export type { EmbeddedStageLoader, EmbeddedStageName } from './app/embedded-stage'
export { createStderrLogger, resolveSessionId } from './app/backend-lifecycle'
export type {
  BackendLifecycleOptions,
  BackendLogger,
  BackendProcessStreams,
  BackendReadyMessage,
  ReadyServer,
} from './app/backend-lifecycle'

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

export interface StandaloneServer {
  readonly config: MegaBrainConfig
  readonly runtime: ServerRuntime
  readonly httpServer: Server
  /** The actual loopback address, available after start resolves. */
  address(): AddressInfo
  start(): Promise<void>
  stop(): Promise<void>
}

export function createStandaloneServer(options: StandaloneServerOptions): StandaloneServer {
  const runtime = options.runtime ?? createServerRuntime()
  const listenOptions = secureListenOptions(options.config, options.listen)
  const limits = { ...DEFAULT_HTTP_LIMITS, ...options.limits }
  const sessionToken = resolveSessionToken(options.sessionToken ?? process.env.MEGA_BRAIN_SESSION_TOKEN)
  const logger = options.logger
  let listenerState: ListenerState = 'starting'
  const httpServer = createServer({ maxHeaderSize: limits.maxHeaderBytes }, (request, response) => {
    void handleHttpRequest(runtime, request, response, sessionToken, {
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
      await listenOnLoopback(httpServer, listenOptions)
      listenerState = 'ready'
    },
    stop: async () => {
      listenerState = 'stopping'
      await closeListener(httpServer)
      listenerState = 'stopped'
    },
  }
}

/** Starts a standalone listener when no composed server is injected. */
export function startBackendLifecycle(options: BackendLifecycleOptions = {}) {
  return emitBackendReady({
    ...options,
    createServer: options.createServer ?? (() => createStandaloneServer({ config: loadMegaBrainConfig() })),
  })
}

export async function runFromCommandLine(options: BackendLifecycleOptions = {}): Promise<void> {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr }
  const sessionId = resolveSessionId(options.sessionId ?? process.env.MEGA_BRAIN_SESSION_ID)
  const structuredLogger = stderrJsonlLogger(streams.stderr, sessionId)
  const logger = options.logger ?? createStderrLogger(streams.stderr, sessionId)
  const owner =
    options.processOwner ??
    createProcessOwner({
      // Only the process groups created through this registry are targeted.
      signalTree: (pid, signal) => process.kill(-pid, signal),
    })
  const config = loadMegaBrainConfig()
  const server =
    options.createServer?.() ??
    createStandaloneServer({
      config,
      // Compose before listening, with the same registry used by shutdown.
      // Service constructors are intentionally side-effect free.
      runtime: createServerRuntime({ config, processOwner: owner }),
      logger: structuredLogger,
      sessionId,
    })
  let removeShutdownHandlers: (() => void) | undefined
  try {
    await startBackendLifecycle({
      ...options,
      createServer: () => server,
      processOwner: owner,
      streams,
      logger,
      sessionId,
    })
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const embeddedStage = process.env.MEGA_BRAIN_STAGE_SCRIPT
  if (embeddedStage) {
    void runEmbeddedStage(embeddedStage).catch(() => {
      process.exitCode = 1
    })
  } else {
    void runFromCommandLine()
  }
}
