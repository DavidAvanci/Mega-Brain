import { ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ProcessRunner } from '../process'
import { openDirectory } from './open-directory'
import { createWorkspaceService } from './service'
import { workspaceHttp } from './http'

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mega-brain-open-directory-'))
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  vi.stubEnv('WSL_DISTRO_NAME', undefined)
})

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

function fixtureRunner(error: Error | null = null) {
  const execFile = vi.fn<ProcessRunner['execFile']>((_command, _args, _options, callback) => callback(error, '', ''))
  const execFileSync = vi.fn<ProcessRunner['execFileSync']>(() => '\\\\wsl.localhost\\Debian\\home\\user\\cards\n')
  const spawn = vi.fn<ProcessRunner['spawn']>(() => {
    const child = new ChildProcess()
    child.unref = vi.fn()
    queueMicrotask(() => child.emit(error ? 'error' : 'spawn', error))
    return child
  })
  const runner: ProcessRunner = { execFile, execFileSync, spawn }
  return { runner, execFile, execFileSync, spawn }
}

test('opens both directory fields without a card name or changing saved settings, preserving literal paths', async () => {
  const workspace = join(root, 'cards')
  const worktrees = join(root, "worktrees com espaço ' $dollar `ticks`")
  mkdirSync(worktrees)
  const { runner, execFile } = fixtureRunner()
  const service = createWorkspaceService({ workspaceDir: workspace, worktreesDir: worktrees, executables: {} }, runner)
  const handler = workspaceHttp(service)
  for (const path of [workspace, worktrees]) {
    expect(
      await handler({
        method: 'POST',
        path: '/settings/open-directory',
        query: new URLSearchParams(),
        headers: {},
        body: { path },
      }),
    ).toMatchObject({ status: 200, body: { ok: true } })
  }
  expect(execFile.mock.calls.map(([command, args]) => [command, args])).toEqual([
    ['/usr/bin/open', [workspace]],
    ['/usr/bin/open', [worktrees]],
  ])
  expect(await service.handle('/settings', 'GET', new URLSearchParams(), undefined)).toMatchObject({
    general: { workspaceDir: workspace, worktreesDir: worktrees },
  })
})

test('rejects missing, relative, invalid and file paths before launching any program', async () => {
  const file = join(root, 'file.txt')
  writeFileSync(file, 'fixture')
  const { runner, execFile, spawn } = fixtureRunner()
  for (const path of [undefined, 123, '', 'relative/path', `${root}\0`, join(root, 'missing'), file]) {
    await expect(openDirectory(path, runner)).rejects.toThrow(/caminho absoluto|pasta não existe/)
  }
  expect(execFile).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})

test('returns a launch failure through HTTP instead of reporting success', async () => {
  const { runner } = fixtureRunner(new Error('OS failure'))
  const handler = workspaceHttp(createWorkspaceService({ workspaceDir: root, executables: {} }, runner))
  expect(
    await handler({
      method: 'POST',
      path: '/settings/open-directory',
      query: new URLSearchParams(),
      headers: {},
      body: { path: root },
    }),
  ).toMatchObject({
    status: 500,
    body: { error: 'Não foi possível abrir a pasta. Verifique o aplicativo configurado.' },
  })
})

test('Linux opens folders through xdg-open and reports opener failures', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  const { runner, execFile } = fixtureRunner()
  await openDirectory(root, runner)
  expect(execFile).toHaveBeenCalledWith('xdg-open', [root], expect.any(Object), expect.any(Function))
  await expect(openDirectory(root, fixtureRunner(new Error('Missing file manager')).runner)).rejects.toThrow(
    'Não foi possível abrir a pasta no gerenciador de arquivos.',
  )
})

test('WSL converts the selected Linux directory for Explorer', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' })
  vi.stubEnv('WSL_DISTRO_NAME', 'Debian')
  const { runner, execFileSync, spawn } = fixtureRunner()
  await openDirectory(root, runner)
  expect(execFileSync).toHaveBeenCalledWith('wslpath', ['-w', root], expect.any(Object))
  expect(spawn).toHaveBeenCalledWith(
    'explorer.exe',
    ['\\\\wsl.localhost\\Debian\\home\\user\\cards'],
    expect.any(Object),
  )
})

test('Windows waits for Explorer to launch and reports unavailable programs', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  const { runner, spawn } = fixtureRunner()
  await openDirectory(root, runner)
  expect(spawn).toHaveBeenCalledWith('explorer.exe', [root], expect.any(Object))
  await expect(openDirectory(root, fixtureRunner(new Error('ENOENT')).runner)).rejects.toThrow(
    'Não foi possível abrir a pasta no gerenciador de arquivos.',
  )
})
