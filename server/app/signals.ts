import type { ProcessOwner } from '../process'

export interface StoppableServer {
  stop(): Promise<void>
}

export interface ShutdownLogger {
  error(message: string): void
  event?(name: string, fields?: Record<string, unknown>): void
}

export interface SignalEmitter {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
  off(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
}

export interface ShutdownHandlerOptions {
  server: StoppableServer
  owner: ProcessOwner
  signals: SignalEmitter
  logger?: ShutdownLogger
}

/** Installs removable, idempotent termination handlers without signalling Node in tests. */
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
  const onSignal = () => {
    void shutdown()
  }
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
