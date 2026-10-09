import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'vitest'
import { resolveOptionalExecutable, desktopCandidates } from './platform'
import { COFFEE_ARGS, createCoffeeService } from './coffee/service'

describe('optional desktop executable discovery', () => {
  test('uses a configured absolute executable and keeps spaces and Unicode out of shell parsing', () => {
    const executable = '/mnt/c/Program Files/Mega Bräin/Cursor.exe'
    expect(
      resolveOptionalExecutable({
        configured: executable,
        candidates: [],
        label: 'Cursor',
        exists: (path) => path === executable,
      }),
    ).toBe(executable)
  })

  test('finds bare commands in PATH and gives an actionable error when absent', () => {
    expect(
      resolveOptionalExecutable({
        candidates: ['wt.exe'],
        label: 'Windows Terminal',
        path: '/opt/bin:/usr/bin',
        exists: (path) => path === '/opt/bin/wt.exe',
      }),
    ).toBe('/opt/bin/wt.exe')
    expect(() =>
      resolveOptionalExecutable({ candidates: ['chrome.exe'], label: 'Chrome', path: '', exists: () => false }),
    ).toThrow('Chrome não está disponível')
  })

  test('WSL candidates preserve direct Windows executables as individual argv commands', () => {
    const env = { WSL_DISTRO_NAME: 'Ubuntu' }
    expect(desktopCandidates('browser', 'linux', env)[0]).toBe(
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    )
    expect(desktopCandidates('terminal', 'linux', env)).toContain('wt.exe')
  })

  test('macOS uses native applications even with a stale WSL environment', () => {
    expect(desktopCandidates('terminal', 'darwin', { WSL_DISTRO_NAME: 'Ubuntu' })).toContain(
      '/System/Applications/Utilities/Terminal.app',
    )
    expect(desktopCandidates('browser', 'darwin')).toEqual(['/usr/bin/open'])
    expect(desktopCandidates('terminal', 'linux', {})).toEqual(['x-terminal-emulator'])
  })
})

test('Coffee clears its session when stopped or when spawning fails', () => {
  const child = Object.assign(new EventEmitter(), { kill: () => true }) as any
  const coffee = createCoffeeService(() => child, '/bin/sh')
  coffee.start()
  expect(coffee.active()).toBe(true)
  coffee.stop()
  expect(coffee.active()).toBe(false)

  const broken = createCoffeeService(() => {
    throw new Error('spawn failed')
  }, '/bin/sh')
  expect(() => broken.start()).toThrow('spawn failed')
  expect(broken.active()).toBe(false)
  expect(COFFEE_ARGS).toEqual(expect.arrayContaining(['-EncodedCommand']))
})
