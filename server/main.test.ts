import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { loadMegaBrainConfig } from './config'
import {
  BACKEND_API_PROTOCOL_VERSION,
  BACKEND_READY_PROTOCOL_VERSION,
  createStandaloneServer,
  runFromCommandLine,
  startBackendLifecycle,
  type BackendProcessStreams,
  type StandaloneServer,
} from './main'
import { createServerRuntime, type ServerRuntime } from './runtime'

describe('standalone Node entrypoint', () => {
  const servers: StandaloneServer[] = []

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()))
    servers.length = 0
  })

  test('binds a fake runtime to an ephemeral IPv4 loopback port and stops cleanly', async () => {
    const token = 'a'.repeat(43)
    const runtime: ServerRuntime = {
      register: () => undefined,
      handle: async (request) => ({
        status: 201,
        body: { received: request.body, query: request.query.get('from') },
      }),
    }
    const server = createStandaloneServer({
      // The fake runtime does not touch disk, avoiding TMP/TEMP entirely.
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-entrypoint-test' }),
      runtime,
      listen: { port: 0 },
      sessionToken: token,
    })
    servers.push(server)

    await server.start()
    const address = server.address()
    expect(address.address).toBe('127.0.0.1')
    expect(address.port).toBeGreaterThan(0)
    const { port } = server.httpServer.address() as AddressInfo
    const response = await fetch(`http://127.0.0.1:${port}/probe?from=test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ safe: true }),
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ received: { safe: true }, query: 'test' })

    await server.stop()
    expect(server.httpServer.listening).toBe(false)
  })

  test('protects every standalone route and does not leak a token in responses', async () => {
    const token = 's'.repeat(43)
    const runtime: ServerRuntime = {
      register: () => undefined,
      handle: async () => { throw new Error(`secret ${token}`) },
    }
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-entrypoint-test' }),
      runtime,
      listen: { port: 0 },
      sessionToken: token,
    })
    servers.push(server)
    await server.start()
    const url = `http://127.0.0.1:${server.address().port}/anything`

    for (const authorization of [undefined, 'Basic credentials', `Bearer ${'x'.repeat(43)}`]) {
      const response = await fetch(url, { headers: authorization ? { Authorization: authorization } : {} })
      expect(response.status).toBe(401)
      expect(await response.text()).not.toContain(token)
    }

    const valid = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    expect(valid.status).toBe(400)
    expect(await valid.text()).not.toContain(token)
  })

  test('applies the closed Tauri CORS policy without changing Vite or allowing wildcards', async () => {
    const token = 'c'.repeat(43)
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-cors-test' }),
      runtime: { register: () => undefined, handle: async () => ({ status: 200, body: { ok: true } }) },
      listen: { port: 0 },
      sessionToken: token,
    })
    servers.push(server)
    await server.start()
    const base = `http://127.0.0.1:${server.address().port}/cors-probe`
    const authorized = { Authorization: `Bearer ${token}` }

    const allowed = await fetch(base, { headers: { ...authorized, Origin: 'http://tauri.localhost' } })
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost')
    expect(allowed.headers.get('vary')).toBe('Origin')
    expect(allowed.headers.get('access-control-allow-origin')).not.toBe('*')
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull()

    const absent = await fetch(base, { headers: authorized })
    expect(absent.status).toBe(200)
    expect(absent.headers.get('access-control-allow-origin')).toBeNull()
    expect(absent.headers.get('vary')).toBeNull()

    for (const origin of [
      'https://evil.example',
      'http://tauri.localhost.evil.example',
      'http://evil-tauri.localhost',
      'http://tauri.localhost:5173',
      'http://tauri.localhost@evil.example',
    ]) {
      const forbidden = await fetch(base, { headers: { ...authorized, Origin: origin } })
      expect(forbidden.status).toBe(403)
      expect(forbidden.headers.get('access-control-allow-origin')).toBeNull()
      expect(forbidden.headers.get('vary')).toBeNull()
    }

    const preflight = await fetch(base, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://tauri.localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://tauri.localhost')
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, POST, DELETE')
    expect(preflight.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type')
    expect(preflight.headers.get('vary')).toBe('Origin')
    expect(preflight.headers.get('access-control-allow-origin')).not.toBe('*')

    const invalidPreflightHeaders: Record<string, string>[] = [
      { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
      { Origin: 'http://tauri.localhost', 'Access-Control-Request-Method': 'PATCH' },
      { Origin: 'http://tauri.localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, x-spoofed' },
      {},
    ]
    for (const headers of invalidPreflightHeaders) {
      const invalid = await fetch(base, { method: 'OPTIONS', headers })
      expect(invalid.status).toBe(403)
      expect(invalid.headers.get('access-control-allow-origin')).toBeNull()
      expect(invalid.headers.get('access-control-allow-methods')).toBeNull()
      expect(invalid.headers.get('access-control-allow-headers')).toBeNull()
    }
  })

  test('reports an authenticated, stable ready health payload without invoking the application runtime', async () => {
    const token = 'h'.repeat(43)
    const runtime: ServerRuntime = { register: () => undefined, handle: async () => { throw new Error('runtime must not handle health') } }
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-health-test' }), runtime, listen: { port: 0 }, sessionToken: token,
    })
    servers.push(server)
    await server.start()
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      service: 'mega-brain-backend', apiProtocolVersion: BACKEND_API_PROTOCOL_VERSION, status: 'ready',
    })
  })

  test('rejects unauthenticated diagnostics and rejects unsupported diagnostic methods', async () => {
    const token = 'm'.repeat(43)
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-health-auth-test' }), runtime: createServerRuntime(), listen: { port: 0 }, sessionToken: token,
    })
    servers.push(server)
    await server.start()
    const base = `http://127.0.0.1:${server.address().port}`
    expect((await fetch(`${base}/health`)).status).toBe(401)
    const method = await fetch(`${base}/version`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    expect(method.status).toBe(405)
    expect(method.headers.get('allow')).toBe('GET')
  })

  test('exposes compatible protocol and Node runtime metadata to the authenticated supervisor', async () => {
    const token = 'v'.repeat(43)
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-version-test' }), runtime: createServerRuntime(), listen: { port: 0 }, sessionToken: token,
      runtimeVersion: '99.1.2-test',
    })
    servers.push(server)
    await server.start()
    const response = await fetch(`http://127.0.0.1:${server.address().port}/version`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      service: 'mega-brain-backend', apiProtocolVersion: BACKEND_API_PROTOCOL_VERSION,
      readyProtocolVersion: BACKEND_READY_PROTOCOL_VERSION, runtime: { name: 'node', version: '99.1.2-test' },
    })
  })

  test('reports not-ready and unavailable fake runtime state as retryable health failures', async () => {
    const token = 'd'.repeat(43)
    let runtimeAvailable = false
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-health-state-test' }), runtime: createServerRuntime(), listen: { port: 0 }, sessionToken: token,
      readiness: () => runtimeAvailable ? { status: 'ready' } : { status: 'starting', reason: 'workspace-loading' },
    })
    servers.push(server)
    await server.start()
    const url = `http://127.0.0.1:${server.address().port}/health`
    const pending = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    expect(pending.status).toBe(503)
    await expect(pending.json()).resolves.toEqual({ service: 'mega-brain-backend', apiProtocolVersion: BACKEND_API_PROTOCOL_VERSION, status: 'starting', reason: 'workspace-loading' })
    runtimeAvailable = true
    expect((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200)

    const unavailable = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-health-throwing-test' }), runtime: createServerRuntime(), listen: { port: 0 }, sessionToken: token,
      readiness: () => { throw new Error('fake runtime failed') },
    })
    servers.push(unavailable)
    await unavailable.start()
    const degraded = await fetch(`http://127.0.0.1:${unavailable.address().port}/health`, { headers: { Authorization: `Bearer ${token}` } })
    expect(degraded.status).toBe(503)
    await expect(degraded.json()).resolves.toEqual({ service: 'mega-brain-backend', apiProtocolVersion: BACKEND_API_PROTOCOL_VERSION, status: 'degraded', reason: 'runtime-status-unavailable' })
  })

  test('rejects a public bind override before a listener is created', () => {
    expect(() => createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-entrypoint-test' }),
      runtime: createServerRuntime(),
      listen: { host: '0.0.0.0', port: 0 },
    })).toThrow('apenas host 127.0.0.1')
  })

  test('writes exactly one versioned, parseable ready line to stdout and diagnostics to stderr', async () => {
    const token = 'never-write-this-token'.padEnd(43, 'x')
    const { streams, output } = captureStreams()
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-ready-test' }),
      runtime: { register: () => undefined, handle: async () => undefined },
      listen: { port: 0 },
      sessionToken: token,
    })
    servers.push(server)

    const ready = await startBackendLifecycle({
      createServer: () => server,
      sessionId: 'test-session-identifier-1234',
      streams,
    })

    const lines = output.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      type: 'mega-brain-ready',
      version: BACKEND_READY_PROTOCOL_VERSION,
      port: server.address().port,
      sessionId: 'test-session-identifier-1234',
    })
    expect(ready.port).toBeGreaterThan(0)
      expect(output.stderr).toContain('"event":"backend.ready"')
    expect(output.stdout + output.stderr).not.toContain(token)
  })

  test('reports startup failures only on stderr, with no ready line or secret', async () => {
    const { streams, output } = captureStreams()
    const previousExitCode = process.exitCode
    process.exitCode = undefined
    try {
      await runFromCommandLine({
        createServer: () => ({ start: async () => { throw new Error('credential-do-not-print') } }) as unknown as StandaloneServer,
        sessionId: 'test-session-identifier-1234',
        streams,
      })
      expect(process.exitCode).toBe(1)
      expect(output.stdout).toBe('')
      expect(output.stderr).toContain('"event":"backend.error"')
      expect(output.stderr).not.toContain('credential-do-not-print')
    } finally {
      process.exitCode = previousExitCode
    }
  })
})

function captureStreams(): { streams: BackendProcessStreams; output: { stdout: string; stderr: string } } {
  const output = { stdout: '', stderr: '' }
  return {
    output,
    streams: {
      stdout: { write: (chunk: string | Uint8Array) => { output.stdout += String(chunk); return true } },
      stderr: { write: (chunk: string | Uint8Array) => { output.stderr += String(chunk); return true } },
    },
  }
}
