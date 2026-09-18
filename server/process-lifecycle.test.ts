import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { installShutdownHandlers, type StandaloneServer } from './main'
import { createProcessOwner } from './process'

class FakeChild extends EventEmitter {
  pid = 42
  exitCode: number | null = null
  killed = false
  signals: string[] = []
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal)
    this.killed = true
    this.exitCode = 0
    queueMicrotask(() => this.emit('exit', 0, signal))
    return true
  }
}

class FakeSignals extends EventEmitter {
  offCalls: string[] = []
  off(event: string | symbol, listener: (...args: any[]) => void): this {
    this.offCalls.push(String(event))
    return super.off(event, listener)
  }
}

test('shutdown owns only registered children and uses TERM before removing listeners', async () => {
  const signalTree: Array<[number, string]> = []
  const owner = createProcessOwner({ timeoutMs: 1, signalTree: (pid, signal) => signalTree.push([pid, signal]) })
  const chat = owner.own(new FakeChild() as any, { label: 'chat' }) as any as FakeChild
  const stage = owner.own(new FakeChild() as any, { tree: true, label: 'stage' }) as any as FakeChild
  const external = new FakeChild()
  const signals = new FakeSignals()
  const steps: string[] = []
  const server = { stop: async () => { steps.push('server') } } as StandaloneServer
  installShutdownHandlers({ server, owner, signals })

  signals.emit('SIGTERM')
  signals.emit('SIGINT')
  await new Promise((resolve) => setTimeout(resolve, 5))

  expect(steps).toEqual(['server'])
  expect(chat.signals).toEqual(['SIGTERM'])
  expect(stage.signals).toEqual([]) // group signalling is injected above
  expect(signalTree).toEqual([[42, 'SIGTERM'], [42, 'SIGKILL']])
  expect(external.signals).toEqual([])
  expect(owner.size).toBe(0)
  expect(signals.listenerCount('SIGTERM')).toBe(0)
  expect(signals.listenerCount('SIGINT')).toBe(0)
  expect(signals.offCalls).toEqual(expect.arrayContaining(['SIGTERM', 'SIGINT']))
})

describe('process ownership', () => {
  test('stops only the requested owned process', async () => {
    const owner = createProcessOwner({ timeoutMs: 1 })
    const target = owner.own(new FakeChild() as any) as any as FakeChild
    const other = owner.own(new FakeChild() as any) as any as FakeChild

    await owner.stop(target as any)

    expect(target.signals).toEqual(['SIGTERM'])
    expect(other.signals).toEqual([])
    expect(owner.size).toBe(1)
  })

  test('shutdown is idempotent and never uses an unregistered child', async () => {
    const owner = createProcessOwner({ timeoutMs: 1 })
    const child = owner.own(new FakeChild() as any) as any as FakeChild
    const external = new FakeChild()
    const first = owner.shutdown()
    const second = owner.shutdown()
    expect(first).toBe(second)
    await first
    expect(child.signals).toEqual(['SIGTERM'])
    expect(external.signals).toEqual([])
  })
})
