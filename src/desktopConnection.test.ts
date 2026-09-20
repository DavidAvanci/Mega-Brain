import { describe, expect, it, vi } from 'vitest'
import { DesktopConnection } from './desktopConnection'
import { DesktopBootstrapError } from './desktopBootstrap'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('desktop connection bootstrap state machine', () => {
  it('shows starting until the one entrypoint bootstrap succeeds', async () => {
    const pending = deferred<void>()
    const boot = vi.fn(() => pending.promise)
    const connection = new DesktopConnection(boot)

    const first = connection.start()
    expect(connection.snapshot()).toEqual({ phase: 'starting', hasConnected: false })
    pending.resolve()
    await first
    expect(connection.snapshot()).toEqual({ phase: 'ready', hasConnected: true })
  })

  it('deduplicates bootstrap calls, including a StrictMode-like repeat', async () => {
    const pending = deferred<void>()
    const boot = vi.fn(() => pending.promise)
    const connection = new DesktopConnection(boot)
    const first = connection.start()
    const duplicate = connection.start()

    expect(duplicate).toBe(first)
    expect(boot).toHaveBeenCalledTimes(1)
    pending.resolve()
    await first
  })

  it('makes an unavailable backend retryable', async () => {
    const boot = vi.fn().mockRejectedValueOnce(new Error('WSL unavailable')).mockResolvedValueOnce(undefined)
    const connection = new DesktopConnection(boot)

    await connection.start()
    expect(connection.snapshot()).toEqual({ phase: 'unavailable', hasConnected: false })
    await connection.start()
    expect(connection.snapshot()).toEqual({ phase: 'ready', hasConnected: true })
    expect(boot).toHaveBeenCalledTimes(2)
  })

  it('waits for the supervisor handshake instead of showing a transient failure', async () => {
    vi.useFakeTimers()
    const boot = vi
      .fn()
      .mockRejectedValueOnce(new DesktopBootstrapError('backend-starting'))
      .mockResolvedValueOnce(undefined)
    const connection = new DesktopConnection(boot)

    const started = connection.start()
    expect(connection.snapshot()).toEqual({ phase: 'starting', hasConnected: false })
    await vi.advanceTimersByTimeAsync(250)
    await started
    expect(connection.snapshot()).toEqual({ phase: 'ready', hasConnected: true })
    expect(boot).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('retains an actionable startup failure for the boundary', async () => {
    const connection = new DesktopConnection(
      vi.fn().mockRejectedValue(new DesktopBootstrapError('runtime-unavailable')),
    )
    await connection.start()
    expect(connection.snapshot()).toEqual({ phase: 'runtime-unavailable', hasConnected: false })
  })

  it('marks an expired session and obtains a fresh handshake on retry', async () => {
    const boot = vi.fn().mockResolvedValue(undefined)
    const connection = new DesktopConnection(boot)
    await connection.start()
    connection.expire()

    expect(connection.snapshot()).toEqual({ phase: 'expired', hasConnected: true })
    await connection.start()
    expect(connection.snapshot()).toEqual({ phase: 'ready', hasConnected: true })
    expect(boot).toHaveBeenCalledTimes(2)
  })

  it('distinguishes a 401 expired session from ordinary HTTP errors', async () => {
    const connection = new DesktopConnection(vi.fn().mockResolvedValue(undefined))
    await connection.start()
    connection.reportApiFailure({ status: 500 })
    expect(connection.snapshot().phase).toBe('ready')
    connection.reportApiFailure({ status: 401 })
    expect(connection.snapshot().phase).toBe('expired')
  })

  it('retains the already-renderable board state during transient failures', async () => {
    const boot = vi.fn().mockResolvedValue(undefined)
    const connection = new DesktopConnection(boot)
    await connection.start()
    connection.unavailable()

    // The boundary uses this sticky bit to keep App (and its cards) mounted.
    expect(connection.snapshot()).toEqual({ phase: 'unavailable', hasConnected: true })
    const reconnect = connection.start()
    expect(connection.snapshot()).toEqual({ phase: 'starting', hasConnected: true })
    await reconnect
  })
})
