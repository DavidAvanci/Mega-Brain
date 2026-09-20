import { request } from 'node:http'
import { afterEach, describe, expect, test } from 'vitest'
import { loadMegaBrainConfig } from './config'
import { createStandaloneServer, type StandaloneServer } from './main'
import type { ServerRuntime } from './runtime'

describe('standalone HTTP limits', () => {
  const servers: StandaloneServer[] = []
  const token = 'l'.repeat(43)
  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()))
    servers.length = 0
  })

  const start = async (runtime: ServerRuntime, limits = {}) => {
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-http-limits-test' }),
      runtime,
      listen: { port: 0 },
      sessionToken: token,
      limits,
    })
    servers.push(server)
    await server.start()
    return `http://127.0.0.1:${server.address().port}`
  }

  test('accepts the exact body limit and rejects streamed excess with a stable 413', async () => {
    const base = await start(
      { register() {}, handle: async (input) => ({ status: 200, body: input.body }) },
      { maxBodyBytes: 7 },
    )
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    expect((await fetch(`${base}/short`, { method: 'POST', headers, body: '"12345"' })).status).toBe(200)
    const response = await fetch(`${base}/short`, { method: 'POST', headers, body: '"123456"' })
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Payload muito grande' })
  })

  test('rejects misleading Content-Length framing before it reaches domain code', async () => {
    const base = await start({ register() {}, handle: async () => ({ status: 200, body: {} }) }, { maxBodyBytes: 7 })
    const response = await rawRequest(
      base,
      '/short',
      { authorization: `Bearer ${token}`, 'content-length': '1' },
      '"123456"',
    )
    // Node's parser stops at the declared byte count; trailing bytes are
    // invalid next-request framing and never reach the domain handler.
    expect(response.status).toBe(400)
    expect(response.body).not.toContain('ok')
  })

  test('times out short work but leaves long chat/SSE work running', async () => {
    const never = () => new Promise<never>(() => undefined)
    const base = await start(
      { register() {}, handle: async (input) => (input.path === '/api/chat/send' ? await never() : await never()) },
      { shortRouteTimeoutMs: 15 },
    )
    const headers = { Authorization: `Bearer ${token}` }
    const short = await fetch(`${base}/short`, { headers })
    expect(short.status).toBe(408)
    const controller = new AbortController()
    const long = fetch(`${base}/api/chat/send`, { method: 'POST', headers, signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 35))
    controller.abort()
    await expect(long).rejects.toThrow()
  })
})

function rawRequest(
  base: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  const url = new URL(path, base)
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path, method: 'POST', headers }, (response) => {
      let result = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        result += chunk
      })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: result }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
