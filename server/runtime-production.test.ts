import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadMegaBrainConfig } from './config'
import type { ProcessRunner } from './process'
import { createServerRuntime } from './runtime'

const request = (method: string, path: string, body?: unknown) => ({
  method,
  path,
  body,
  query: new URLSearchParams(),
  headers: {},
})

describe('production runtime composition', () => {
  test('registers every domain route without I/O or child processes at startup', async () => {
    const base = mkdtempSync(join(tmpdir(), 'mega-brain-runtime-'))
    const workspace = join(base, 'workspace')
    const claude = join(base, 'claude')
    let spawns = 0
    const child = Object.assign(new EventEmitter(), {
      kill: () => true,
      unref: () => undefined,
      pid: 12345,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })
    const runner: ProcessRunner = {
      spawn: () => {
        spawns++
        return child as any
      },
      execFileSync: () => '',
      execFile: (_command, _args, _options, callback) => callback(null, '', ''),
    }
    const config = loadMegaBrainConfig({
      env: { WORKSPACE_DIR: workspace, MEGA_BRAIN_CLAUDE_HOME: claude, MEGA_BRAIN_POWERSHELL_BIN: '/bin/sh' },
      homeDir: base,
    })
    const runtime = createServerRuntime({ config, processRunner: runner })

    // Constructors only compose dependencies. In particular they must not
    // create a workspace, read credentials, call Jira, or launch PowerShell.
    expect(existsSync(workspace)).toBe(false)
    expect(spawns).toBe(0)
    mkdirSync(join(workspace, 'card'), { recursive: true })
    mkdirSync(join(claude, 'projects'), { recursive: true })

    expect((await runtime.handle(request('GET', '/api/workspace/settings')))?.status).toBe(200)
    expect((await runtime.handle(request('GET', '/api/workspace/settings/editors')))?.status).toBe(200)
    expect(
      (await runtime.handle({ ...request('GET', '/api/chat'), query: new URLSearchParams('name=card') }))?.status,
    ).toBe(200)
    expect(((await runtime.handle(request('GET', '/api/jira/ready'))) as any)?.body).toEqual([])
    expect((await runtime.handle(request('GET', '/api/claude/usage')))?.status).toBe(200)
    expect(((await runtime.handle(request('POST', '/api/coffee'))) as any)?.body).toEqual({ active: true })
    expect(spawns).toBe(1)
    expect(((await runtime.handle(request('DELETE', '/api/coffee'))) as any)?.body).toEqual({ active: false })
  })
})
