import { expect, test } from 'vitest'
import type { ApiHandler, ApiRequest } from './contracts'
import { chatAbortHttp, chatHistoryHttp, chatSendHttp, formatSseEvent, SSE_HEADERS } from './chat/http'
import { claudeUsageHttp } from './claude-usage/http'
import { coffeeHttp } from './coffee/http'
import { jiraReadyHttp, jiraStatusesHttp, jiraTransitionHttp } from './jira/http'
import { workspaceHttp } from './workspace/http'

type JsonRoute = { label: string; method: string; path: string; query?: string; body?: unknown; handler: ApiHandler }
const request = (route: Pick<JsonRoute, 'method' | 'path' | 'query' | 'body'>): ApiRequest => ({
  method: route.method,
  path: route.path,
  query: new URLSearchParams(route.query),
  headers: { 'x-contract-test': 'true' },
  body: route.body,
})

/** All dependencies are fakes: this suite cannot read a workspace or launch a process. */
function fixtures(fail = false) {
  const calls: Array<{ area: string; args: unknown[] }> = []
  const failure = () => {
    if (fail) throw new Error('falha simulada')
  }
  const workspace = workspaceHttp({
    handle: async (path, method, query, body) => {
      calls.push({ area: 'workspace', args: [path, method, query.toString(), body] })
      if (body && typeof body === 'object' && (body as { invalid?: boolean }).invalid)
        throw new Error('payload inválido')
      if (query.get('name') === 'invalido') throw new Error('payload inválido')
      failure()
      return { route: `${method} ${path}` }
    },
  })
  const chat = {
    history: async (name: string) => {
      calls.push({ area: 'chat-history', args: [name] })
      if (!name || name === 'invalido') throw new Error('payload inválido')
      failure()
      return { sessionId: null, entries: [] }
    },
    abort: (name: string) => {
      calls.push({ area: 'chat-abort', args: [name] })
      if (!name || name === 'invalido') throw new Error('payload inválido')
      failure()
      return true
    },
    send: (name: string, text: string, emit: (event: any) => void) => {
      calls.push({ area: 'chat-send', args: [name, text] })
      if (!name || !text || name === 'invalido') throw new Error('payload inválido')
      failure()
      emit({ type: 'text', text: 'ok' })
      emit({ type: 'done' })
    },
  }
  const jira = {
    ready: async () => {
      calls.push({ area: 'jira-ready', args: [] })
      failure()
      return []
    },
    statuses: async (keys: string) => {
      calls.push({ area: 'jira-statuses', args: [keys] })
      if (!keys || keys === 'invalido') throw new Error('payload inválido')
      failure()
      return { 'MB-1': 'READY' }
    },
    transition: async (key: string, status: string) => {
      calls.push({ area: 'jira-transition', args: [key, status] })
      if (!key || !status || key === 'INVALIDO') throw new Error('payload inválido')
      failure()
      return { status }
    },
  }
  const usage = {
    getUsage: async () => {
      calls.push({ area: 'usage', args: [] })
      failure()
      return { fiveHour: null, sevenDay: null, fable: null }
    },
  }
  let active = false
  const coffee = {
    start: () => {
      calls.push({ area: 'coffee-start', args: [] })
      failure()
      active = true
    },
    stop: () => {
      calls.push({ area: 'coffee-stop', args: [] })
      failure()
      active = false
    },
    active: () => active,
  }
  return {
    calls,
    routes: [
      ...(
        [
          ['GET /api/workspace', 'GET', '/', '', undefined],
          ['GET /api/workspace/settings', 'GET', '/settings', '', undefined],
          ['GET /api/workspace/settings/editors', 'GET', '/settings/editors', '', undefined],
          ['GET /api/workspace/detail', 'GET', '/detail', 'name=card', undefined],
          ['GET /api/workspace/diff', 'GET', '/diff', 'name=card', undefined],
          ['POST /api/workspace', 'POST', '/', '', { title: 'Card' }],
          ['POST /api/workspace/settings', 'POST', '/settings', '', { stages: {} }],
          ['POST /api/workspace/open', 'POST', '/open', '', { name: 'card' }],
          ['POST /api/workspace/terminal', 'POST', '/terminal', '', { name: 'card' }],
          ['POST /api/workspace/prs/open', 'POST', '/prs/open', '', { name: 'card', env: 'staging' }],
          ['POST /api/workspace/dev-env', 'POST', '/dev-env', '', { name: 'card', frontend: 'web' }],
          ['POST /api/workspace/dev-env/stop', 'POST', '/dev-env/stop', '', { name: 'card' }],
          ['POST /api/workspace/dev-env/open', 'POST', '/dev-env/open', '', { name: 'card', repo: 'web' }],
          ['POST /api/workspace/dev-env/agent', 'POST', '/dev-env/agent', '', { name: 'card' }],
          ['POST /api/workspace/stage/reset', 'POST', '/stage/reset', '', { name: 'card', stage: 'task-planning' }],
          ['POST /api/workspace/update', 'POST', '/update', '', { name: 'card', status: 'planejando' }],
          ['POST /api/workspace/delete', 'POST', '/delete', '', { name: 'card' }],
        ] as const
      ).map(([label, method, path, query, body]) => ({ label, method, path, query, body, handler: workspace })),
      { label: 'GET /api/chat', method: 'GET', path: '/', query: 'name=card', handler: chatHistoryHttp(chat) },
      {
        label: 'POST /api/chat/abort',
        method: 'POST',
        path: '/abort',
        body: { name: 'card' },
        handler: chatAbortHttp(chat),
      },
      { label: 'GET /api/jira/ready', method: 'GET', path: '/ready', handler: jiraReadyHttp(jira) },
      {
        label: 'GET /api/jira/statuses',
        method: 'GET',
        path: '/statuses',
        query: 'keys=MB-1',
        handler: jiraStatusesHttp(jira),
      },
      {
        label: 'POST /api/jira/transition',
        method: 'POST',
        path: '/transition',
        body: { key: 'mb-1', status: 'READY' },
        handler: jiraTransitionHttp(jira),
      },
      { label: 'GET /api/claude/usage', method: 'GET', path: '/', handler: claudeUsageHttp(usage) },
      { label: 'POST /api/coffee', method: 'POST', path: '/', handler: coffeeHttp(coffee) },
      { label: 'DELETE /api/coffee', method: 'DELETE', path: '/', handler: coffeeHttp(coffee) },
    ] satisfies JsonRoute[],
    chat,
  }
}

test('contract matrix: every JSON route forwards its exact method/path/query/body and returns the JSON envelope', async () => {
  const { routes, calls } = fixtures()
  expect(routes).toHaveLength(25)
  for (const route of routes) {
    const response = await route.handler(request(route))
    expect(response, route.label).toMatchObject({ status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const workspaceCalls = calls.filter((call) => call.area === 'workspace')
  expect(workspaceCalls).toHaveLength(17)
  expect(workspaceCalls.map(({ args }) => [args[0], args[1], args[2], args[3]])).toEqual(
    routes.slice(0, 17).map((route) => [route.path, route.method, route.query ?? '', route.body]),
  )
})

test('contract matrix: every JSON route converts service failures into the legacy 500 error envelope', async () => {
  const { routes } = fixtures(true)
  for (const route of routes) {
    const response = await route.handler(request(route))
    expect(response, route.label).toEqual({
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'falha simulada' },
    })
  }
})

test('contract matrix: routes with request input report invalid query/body through the same legacy envelope', async () => {
  const { routes } = fixtures()
  const inputRoutes = routes.filter(
    (route) =>
      ![
        'GET /api/workspace',
        'GET /api/workspace/settings',
        'GET /api/jira/ready',
        'GET /api/claude/usage',
        'POST /api/coffee',
        'DELETE /api/coffee',
      ].includes(route.label),
  )
  for (const route of inputRoutes) {
    const invalid: JsonRoute =
      route.query !== undefined ? { ...route, query: 'name=invalido' } : { ...route, body: { invalid: true } }
    if (route.label === 'GET /api/jira/statuses') invalid.query = 'keys=invalido'
    if (route.label === 'POST /api/jira/transition') invalid.body = { key: 'invalido', status: '' }
    if (route.label === 'POST /api/chat/abort') invalid.body = { name: 'invalido' }
    const response = await invalid.handler(request(invalid))
    expect(response, route.label).toEqual({
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'payload inválido' },
    })
  }
})

test('contract matrix: chat SSE has exact framing, invalid payload terminates, and abort/cancellation is routed', async () => {
  const { chat, calls } = fixtures()
  const success = await chatSendHttp(chat)({
    method: 'POST',
    path: '/',
    query: new URLSearchParams(),
    headers: {},
    body: { name: 'card', text: 'oi' },
  })
  const frames: string[] = []
  success.stream((event) => frames.push(formatSseEvent(event)))
  expect({ status: success.status, headers: success.headers, frames }).toEqual({
    status: 200,
    headers: SSE_HEADERS,
    frames: ['data: {"type":"text","text":"ok"}\n\n', 'data: {"type":"done"}\n\n'],
  })
  const invalid = await chatSendHttp(chat)({
    method: 'POST',
    path: '/',
    query: new URLSearchParams(),
    headers: {},
    body: { name: 'card', text: '' },
  })
  const cancellation: any[] = []
  invalid.stream((event) => cancellation.push(event))
  expect(cancellation).toEqual([{ type: 'done', error: 'payload inválido' }])
  const abort = await chatAbortHttp(chat)({
    method: 'POST',
    path: '/abort',
    query: new URLSearchParams(),
    headers: {},
    body: { name: 'card' },
  })
  expect(abort.body).toEqual({ ok: true })
  expect(calls.filter((call) => call.area === 'chat-abort')).toHaveLength(1)
})
