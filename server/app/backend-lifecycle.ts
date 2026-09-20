import { randomBytes } from 'node:crypto'
import type { Writable } from 'node:stream'
import type { ProcessOwner } from '../process'
import { stderrJsonlLogger } from '../logger'
import { BACKEND_READY_PROTOCOL_VERSION } from '../http/diagnostics'
import type { SignalEmitter } from './signals'

export interface BackendLogger {
  info(message: string): void
  error(message: string): void
  event?(name: string, fields?: Record<string, unknown>): void
}

export interface BackendProcessStreams {
  stdout: Pick<Writable, 'write'>
  stderr: Pick<Writable, 'write'>
}

/** Small lifecycle boundary, keeping startup protocol independent of HTTP. */
export interface ReadyServer {
  address(): { port: number }
  start(): Promise<void>
  stop(): Promise<void>
}

export interface BackendLifecycleOptions {
  createServer?: () => ReadyServer
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

/** Starts the listener and emits precisely one supervisor-ready JSON line. */
export async function startBackendLifecycle(options: BackendLifecycleOptions = {}): Promise<BackendReadyMessage> {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr }
  const logger = options.logger ?? createStderrLogger(streams.stderr)
  if (!options.createServer) throw new Error('Servidor do backend não configurado')
  const server = options.createServer()
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

export function createStderrLogger(stderr: Pick<Writable, 'write'>, sessionId?: string): BackendLogger {
  const structured = stderrJsonlLogger(stderr, sessionId)
  return {
    info: () => structured.event('backend.info'),
    error: () => structured.event('backend.error'),
    event: structured.event,
  }
}

export function resolveSessionId(value: string | undefined): string {
  if (value === undefined) return randomBytes(16).toString('base64url')
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new Error('MEGA_BRAIN_SESSION_ID inválido')
  }
  return value
}
