import { useSyncExternalStore } from 'react'
import { apiClientMode } from './shared/api/api-client'
import { bootstrapDesktopApiClient } from './desktopBootstrap'
import { DesktopBootstrapError, type DesktopBootstrapFailure } from './desktopBootstrap'

export type DesktopConnectionPhase = 'starting' | 'ready' | 'unavailable' | 'expired' | DesktopBootstrapFailure

export interface DesktopConnectionState {
  phase: DesktopConnectionPhase
  /** Once true, transient reconnects must not unmount the user's board. */
  hasConnected: boolean
}

type Bootstrap = () => Promise<unknown>
const STARTUP_RETRY_DELAY_MS = 250
const STARTUP_RETRY_ATTEMPTS = 40

/**
 * A deliberately small external state machine. Bootstrap belongs to the
 * entrypoint, not to a component effect, so StrictMode cannot start it twice.
 */
export class DesktopConnection {
  private state: DesktopConnectionState = { phase: 'starting', hasConnected: false }
  private readonly listeners = new Set<() => void>()
  private pending: Promise<void> | undefined

  constructor(private readonly bootstrap: Bootstrap) {}

  snapshot = (): DesktopConnectionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(next: DesktopConnectionState): void {
    if (this.state.phase === next.phase && this.state.hasConnected === next.hasConnected) return
    this.state = next
    this.listeners.forEach((listener) => listener())
  }

  private async bootstrapWhenReady(): Promise<unknown> {
    for (let attempt = 0; attempt < STARTUP_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await this.bootstrap()
      } catch (error) {
        if (!(error instanceof DesktopBootstrapError) || error.failure !== 'backend-starting') throw error
        if (attempt === STARTUP_RETRY_ATTEMPTS - 1) throw new DesktopBootstrapError('supervisor-failed')
        await new Promise<void>((resolve) => setTimeout(resolve, STARTUP_RETRY_DELAY_MS))
      }
    }
    throw new DesktopBootstrapError('supervisor-failed')
  }

  start(): Promise<void> {
    if (this.pending) return this.pending
    this.set({ phase: 'starting', hasConnected: this.state.hasConnected })
    const pending = this.bootstrapWhenReady()
      .then(() => this.set({ phase: 'ready', hasConnected: true }))
      .catch((error) =>
        this.set({
          phase: error instanceof DesktopBootstrapError ? error.failure : 'unavailable',
          hasConnected: this.state.hasConnected,
        }),
      )
      .finally(() => {
        if (this.pending === pending) this.pending = undefined
      })
    this.pending = pending
    return pending
  }

  expire(): void {
    if (this.state.phase !== 'starting') this.set({ phase: 'expired', hasConnected: this.state.hasConnected })
  }

  unavailable(): void {
    if (this.state.phase !== 'starting') this.set({ phase: 'unavailable', hasConnected: this.state.hasConnected })
  }

  reportApiFailure(error: unknown): void {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      if ((error as { status?: unknown }).status === 401) this.expire()
      return
    }
    this.unavailable()
  }
}

const desktopConnection = new DesktopConnection(bootstrapDesktopApiClient)

export function startDesktopConnection(): Promise<void> {
  return desktopConnection.start()
}

export function retryDesktopConnection(): Promise<void> {
  return desktopConnection.start()
}

/** Classifies transport failures without turning ordinary HTTP validation errors into reconnect prompts. */
export function reportDesktopApiFailure(error: unknown): void {
  if (apiClientMode() !== 'desktop') return
  desktopConnection.reportApiFailure(error)
}

export function useDesktopConnection(): DesktopConnectionState {
  return useSyncExternalStore(desktopConnection.subscribe, desktopConnection.snapshot)
}
