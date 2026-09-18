import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { expect, test } from 'vitest'
import { COFFEE_ARGS, createCoffee } from './coffeePlugin'

function fakeChild() {
  const child = new EventEmitter() as ChildProcess & { killed: boolean }
  child.killed = false
  child.kill = () => {
    child.killed = true
    return true
  }
  return child
}

test('createCoffee mantém uma sessão por vez', () => {
  const spawned: ReturnType<typeof fakeChild>[] = []
  const coffee = createCoffee(() => {
    const child = fakeChild()
    spawned.push(child)
    return child
  })

  expect(coffee.active()).toBe(false)
  coffee.start()
  coffee.start()
  expect(spawned).toHaveLength(1)
  expect(coffee.active()).toBe(true)

  coffee.stop()
  expect(spawned[0].killed).toBe(true)
  expect(coffee.active()).toBe(false)
})

test('createCoffee desativa quando o powershell termina', () => {
  const spawned: ReturnType<typeof fakeChild>[] = []
  const coffee = createCoffee(() => {
    const child = fakeChild()
    spawned.push(child)
    return child
  })

  coffee.start()
  spawned[0].emit('exit', 0, null)
  expect(coffee.active()).toBe(false)

  coffee.start()
  expect(spawned).toHaveLength(2)
})

test('COFFEE_ARGS carrega o script codificado', () => {
  const script = Buffer.from(COFFEE_ARGS[3], 'base64').toString('utf16le')
  expect(script).toContain('LockWorkStation')
  expect(script).toContain('Get-Process LogonUI')
})
