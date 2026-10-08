import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, test } from 'vitest'
import { loadMegaBrainConfig } from '../config'
import { createServerRuntime } from '../runtime'
import type { ProcessRunner } from '../process'
import type { ApiRequest } from '../contracts'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))
const request = (method: string, path: string, body?: unknown): ApiRequest => ({
  method,
  path,
  body,
  query: new URLSearchParams(),
  headers: {},
})

test('usage caches are scoped to profile homes and default changes take effect without a restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-profile-usage-'))
  directories.push(root)
  const workHome = join(root, '.codex-work')
  const personalHome = join(root, '.codex-personal')
  const homes: string[] = []
  const runner: ProcessRunner = {
    spawn(_command, args, options) {
      expect(args).toEqual(['app-server'])
      const home = String(options?.env?.CODEX_HOME)
      homes.push(home)
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr: null, kill: () => true })
      stdin.on('data', (chunk: Buffer) => {
        const packet = JSON.parse(chunk.toString()) as { id?: number }
        if (packet.id === undefined) return
        const result =
          packet.id === 0
            ? {}
            : home === workHome
              ? { rateLimits: { primary: { usedPercent: 35, windowDurationMins: 300 } } }
              : {}
        queueMicrotask(() => stdout.write(JSON.stringify({ id: packet.id, result }) + '\n'))
      })
      return child as unknown as ChildProcess
    },
    execFileSync: () => '',
    execFile: (_command, _args, _options, callback) => callback(null, '', ''),
  }
  const config = loadMegaBrainConfig({
    homeDir: root,
    env: {
      WORKSPACE_DIR: join(root, 'cards'),
      MEGA_BRAIN_SETTINGS_FILE: join(root, 'settings.json'),
    },
  })
  const runtime = createServerRuntime({ config, processRunner: runner })
  const profiles = [
    { id: 'work', name: 'Trabalho', home: workHome, color: '#123abc' },
    { id: 'personal', name: 'Pessoal', home: personalHome, color: '#abcdef' },
  ]
  expect((await runtime.handle(request('PUT', '/api/codex/profiles', { profiles, activeId: 'work' })))?.status).toBe(
    200,
  )
  expect(await runtime.handle(request('GET', '/api/codex/usage'))).toMatchObject({
    status: 200,
    body: { codexProfileId: 'work', codexProfileName: 'Trabalho', fiveHour: { utilization: 35 } },
  })
  await runtime.handle(request('PUT', '/api/codex/profiles', { profiles, activeId: 'personal' }))
  expect(await runtime.handle(request('GET', '/api/codex/usage'))).toMatchObject({
    status: 200,
    body: { codexProfileId: 'personal', codexProfileName: 'Pessoal', fiveHour: null, sevenDay: null },
  })
  await runtime.handle(
    request('PUT', '/api/codex/profiles', {
      profiles: profiles.map((profile) => (profile.id === 'work' ? { ...profile, name: 'Takeat' } : profile)),
      activeId: 'work',
    }),
  )
  expect(await runtime.handle(request('GET', '/api/codex/usage'))).toMatchObject({
    body: { codexProfileId: 'work', codexProfileName: 'Takeat', fiveHour: { utilization: 35 } },
  })
  expect(homes).toEqual([workHome, personalHome])
})
