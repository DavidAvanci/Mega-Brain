import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { createViteApiAdapter } from '../viteApiAdapter'
import { createViteRouteHandler } from '../viteMegaBrainPlugin'
import type { ChatEvent } from '../shared/contracts/chat'
import { chatHistoryHttp, chatSendHttp } from './chat/http'
import { claudeUsageHttp } from './claude-usage/http'
import { coffeeHttp } from './coffee/http'
import { loadMegaBrainConfig } from './config'
import { legacyJsonHandler, type ApiHandler, type SseHandler } from './contracts'
import { jiraReadyHttp, jiraStatusesHttp, jiraTransitionHttp } from './jira/http'
import { createStandaloneServer, type StandaloneServer } from './main'
import { createServerRuntime } from './runtime'
import { workspaceHttp } from './workspace/http'

type Route = ApiHandler | SseHandler
type Transport = { name: 'vite' | 'node'; base: string }
const token = 'p'.repeat(43)
const standalone: StandaloneServer[] = []
const harness: Server[] = []
let fixture: ReturnType<typeof fakeRoutes>

afterEach(async () => {
  await Promise.all(standalone.splice(0).map((server) => server.stop()))
  await Promise.all(harness.splice(0).map(close))
})

/** Runs the exact same HTTP assertions through Connect/Vite glue and node:http.
 * The Vite side is a mount-faithful harness, never a Vite server on 5173. */
describe.each(['vite', 'node'] as const)('shared contract: %s transport', (name) => {
  test('five domains preserve JSON success and domain-error envelopes', async () => {
    const transport = await start(name)
    const cases = [
      ['GET', '/api/workspace/settings', undefined, 200, { route: 'GET /settings' }],
      ['GET', '/api/chat?name=card', undefined, 200, { sessionId: null, entries: [] }],
      ['GET', '/api/jira/ready', undefined, 200, []],
      ['GET', '/api/claude/usage', undefined, 200, { fiveHour: null, sevenDay: null, fable: null }],
      ['POST', '/api/coffee', {}, 200, { active: true }],
      ['GET', '/api/workspace/detail?name=invalid', undefined, 500, { error: 'falha simulada' }],
      ['GET', '/api/chat?name=invalid', undefined, 500, { error: 'falha simulada' }],
      ['GET', '/api/jira/statuses?keys=invalid', undefined, 500, { error: 'falha simulada' }],
      ['GET', '/api/claude/usage?fail=1', undefined, 500, { error: 'falha simulada' }],
      ['POST', '/api/coffee', { fail: true }, 500, { error: 'falha simulada' }],
    ] as const
    for (const [method, path, body, status, json] of cases) {
      const response = await request(transport, method, path, body)
      expect(response.status, `${method} ${path}`).toBe(status)
      expect(response.json).toEqual(json)
      expect(response.headers.get('content-type')).toContain('application/json')
    }
  })

  test('methods, missing routes and input errors are parity domain responses', async () => {
    const transport = await start(name)
    for (const [method, path, body, status, json] of [
      ['DELETE', '/api/jira/ready', undefined, 404, { error: 'Rota não encontrada' }],
      ['GET', '/api/nope', undefined, 404, { error: 'Rota não encontrada' }],
      ['POST', '/api/jira/transition', { key: 'INVALID', status: '' }, 500, { error: 'payload inválido' }],
    ] as const) {
      const response = await request(transport, method, path, body)
      expect(response.status).toBe(status)
      expect(response.json).toEqual(json)
    }
  })

  test('SSE exposes the first frame before cancellation and calls cancel exactly once', async () => {
    const transport = await start(name)
    const response = await fetch(`${transport.base}/api/chat/send`, {
      method: 'POST',
      headers: headers(transport, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: 'card', text: 'oi' }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe('data: {"type":"text","text":"primeiro"}\n\n')
    await reader.cancel()
    await expectEventually(() => expect(fixture.cancelled).toBe(1))
  })
})

async function expectEventually(assertion: () => void, timeoutMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  do {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  } while (Date.now() < deadline)
  throw lastError
}

describe('allowed transport differences', () => {
  test('only standalone applies bearer auth, closed CORS, and a boundary-specific malformed JSON status', async () => {
    const node = await start('node')
    const vite = await start('vite')
    expect((await fetch(`${node.base}/api/jira/ready`)).status).toBe(401)
    expect((await fetch(`${vite.base}/api/jira/ready`)).status).toBe(200)
    const cors = await fetch(`${node.base}/api/jira/ready`, {
      headers: headers(node, { Origin: 'http://tauri.localhost' }),
    })
    expect(cors.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost')
    const invalidOrigin = await fetch(`${node.base}/api/jira/ready`, {
      headers: headers(node, { Origin: 'http://evil.example' }),
    })
    expect(invalidOrigin.status).toBe(403)
    for (const transport of [node, vite]) {
      const malformed = await fetch(`${transport.base}/api/jira/ready`, {
        method: 'POST',
        headers: headers(transport, { 'Content-Type': 'application/json' }),
        body: '{',
      })
      expect(malformed.status).toBe(transport.name === 'node' ? 400 : 500)
    }
  })
})

async function start(name: Transport['name']): Promise<Transport> {
  fixture = fakeRoutes()
  if (name === 'node') {
    const runtime = createServerRuntime()
    for (const [key, handler] of fixture.routes) {
      const [method, path] = key.split(' ', 2)
      runtime.register(method, path, handler)
    }
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-transport-parity' }),
      runtime,
      listen: { port: 0 },
      sessionToken: token,
    })
    standalone.push(server)
    await server.start()
    return { name, base: `http://127.0.0.1:${server.address().port}` }
  }
  const adapter = createViteApiAdapter({ pathPrefix: '/api', fallback: createViteRouteHandler(fixture.routes) })
  const server = createServer((req, res) => connectMounted(adapter, req, res))
  harness.push(server)
  await listen(server)
  return { name, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

function connectMounted(
  adapter: ReturnType<typeof createViteApiAdapter>,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = req.url ?? '/'
  if (!url.startsWith('/api')) return notFound(res)
  req.url = url.slice('/api'.length) || '/'
  adapter(req, res, () => notFound(res))
}

function fakeRoutes(): { routes: ReadonlyMap<string, Route>; readonly cancelled: number } {
  let coffeeActive = false
  let cancelled = 0
  const workspace = workspaceHttp({
    handle: async (path, method, query) => {
      if (query.get('name') === 'invalid') throw new Error('falha simulada')
      return { route: `${method} ${path}` }
    },
  })
  const absoluteWorkspace: ApiHandler = (request) =>
    workspace({ ...request, path: request.path.slice('/api/workspace'.length) || '/' })
  const chat = {
    history: async (card: string) => {
      if (!card || card === 'invalid') throw new Error('falha simulada')
      return { sessionId: null, entries: [] }
    },
    abort: () => true,
    send: (_card: string, _text: string, emit: (event: ChatEvent) => void) => {
      emit({ type: 'text', text: 'primeiro' })
    },
  }
  const jira = {
    ready: async () => [],
    statuses: async (keys: string) => {
      if (keys === 'invalid') throw new Error('falha simulada')
      return { 'MB-1': 'READY' }
    },
    transition: async (key: string, status: string) => {
      if (!key || !status || key === 'INVALID') throw new Error('payload inválido')
      return { status }
    },
  }
  const usage = { getUsage: async () => ({ fiveHour: null, sevenDay: null, fable: null }) }
  const coffee = {
    start: () => {
      coffeeActive = true
    },
    stop: () => {
      coffeeActive = false
    },
    active: () => coffeeActive,
  }
  const routes = new Map<string, Route>([
    ['GET /api/workspace/settings', absoluteWorkspace],
    ['GET /api/workspace/detail', absoluteWorkspace],
    ['GET /api/chat', chatHistoryHttp(chat)],
    [
      'POST /api/chat/send',
      async (request) => {
        const result = await chatSendHttp(chat)(request)
        return {
          ...result,
          cancel: () => {
            cancelled += 1
          },
        }
      },
    ],
    ['GET /api/jira/ready', jiraReadyHttp(jira)],
    ['GET /api/jira/statuses', jiraStatusesHttp(jira)],
    ['POST /api/jira/transition', jiraTransitionHttp(jira)],
    [
      'GET /api/claude/usage',
      legacyJsonHandler(async (request) => {
        if (request.query.get('fail') === '1') throw new Error('falha simulada')
        return claudeUsageHttp(usage)(request)
      }),
    ],
    [
      'POST /api/coffee',
      legacyJsonHandler(async (request) => {
        if ((request.body as { fail?: boolean } | undefined)?.fail) throw new Error('falha simulada')
        return coffeeHttp(coffee)(request)
      }),
    ],
  ])
  return {
    routes,
    get cancelled() {
      return cancelled
    },
  }
}

async function request(transport: Transport, method: string, path: string, body?: unknown) {
  const response = await fetch(`${transport.base}${path}`, {
    method,
    headers: headers(transport, body === undefined ? {} : { 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, headers: response.headers, json: await response.json() }
}
function headers(transport: Transport, value: Record<string, string>): Record<string, string> {
  return transport.name === 'node' ? { ...value, Authorization: `Bearer ${token}` } : value
}
function notFound(response: ServerResponse): void {
  response.statusCode = 404
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ error: 'Rota não encontrada' }))
}
function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    }),
  )
}
function close(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}
