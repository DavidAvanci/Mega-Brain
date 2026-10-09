import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createStandaloneServer, type StandaloneServer } from '../../main'
import { loadMegaBrainConfig } from '../../config'
import { createServerRuntime } from '../../runtime'
import { devEnvAgentControlHttp, devEnvAgentSendHttp } from './dev-env-agent-http'
import { DEV_ENV_AGENT_ADAPTER } from './dev-env-agent'
import { devEnvCapability, devEnvCapabilityCard } from './dev-env-capability'
import type { ChatEvent } from '../../../shared/contracts/chat'

const roots: string[] = []
const servers: StandaloneServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('adaptador Node no desktop inicia seleção e só acessa o ambiente do card autorizado', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-env-control-'))
  roots.push(root)
  const config = loadMegaBrainConfig({
    homeDir: root,
    env: { MEGA_BRAIN_WORKSPACE_DIR: join(root, 'workspace'), MEGA_BRAIN_SETTINGS_FILE: join(root, 'settings.json') },
  })
  config.workspaceDir = join(root, 'workspace')
  mkdirSync(config.workspaceDir)
  const runtime = createServerRuntime()
  const calls: { path: string; method: string; name: string | null; body: unknown }[] = []
  runtime.register(
    'POST',
    '/api/dev-env-agent/control',
    devEnvAgentControlHttp({
      async handle(path, method, query, body) {
        calls.push({ path, method, name: query.get('name'), body })
        if (path === '/dev-env/preview')
          return {
            docker: false,
            projects: [
              { repo: 'api-garcom-digital', port: 4100, selected: true },
              { repo: 'manager-area', port: 5173, selected: false },
            ],
          }
        return { status: 'rodando', apps: [] }
      },
    }),
  )
  runtime.register('POST', '/api/workspace/delete', async () => ({ status: 200, body: { unexpected: true } }))
  const server = createStandaloneServer({ config, runtime, listen: { port: 0 }, sessionToken: 'b'.repeat(43) })
  servers.push(server)
  await server.start()
  const base = `http://127.0.0.1:${server.address().port}`
  const token = devEnvCapability('MB-1')
  const file = join(root, 'agent.mjs')
  writeFileSync(file, DEV_ENV_AGENT_ADAPTER)
  const run = (action: string) =>
    new Promise<string>((resolve, reject) =>
      execFile(
        process.execPath,
        [file, action],
        {
          cwd: root,
          env: {
            ...process.env,
            MEGA_BRAIN_KNOWLEDGE_URL: base,
            MEGA_BRAIN_DEV_ENV_CARD: 'MB-1',
            MEGA_BRAIN_DEV_ENV_CAPABILITY: token,
          },
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    )
  expect(JSON.parse(await run('start'))).toMatchObject({ status: 'rodando' })
  expect(calls[1]).toEqual({
    path: '/dev-env',
    method: 'POST',
    name: 'MB-1',
    body: {
      name: 'MB-1',
      configuration: { docker: false, projects: [{ repo: 'api-garcom-digital', port: 4100 }] },
      file: undefined,
    },
  })
  await run('status')
  expect(calls.at(-1)).toMatchObject({ path: '/dev-env', method: 'GET', name: 'MB-1' })
  const request = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Mega-Dev-Env-Capability': token, ...headers },
      body: JSON.stringify(body),
    })
  expect((await request('/api/workspace/delete', { name: 'MB-1' })).status).toBe(401)
  expect((await request('/api/dev-env-agent/control', { action: 'stop', name: 'MB-2' })).status).toBe(200)
  expect(calls.at(-1)?.body).toMatchObject({ name: 'MB-1' })
  expect(
    (await request('/api/dev-env-agent/control', { action: 'preview' }, { Origin: 'http://localhost:5173' })).status,
  ).toBe(403)
  expect(
    (await request('/api/dev-env-agent/control', { action: 'preview' }, { 'X-Mega-Dev-Env-Capability': 'invalid' }))
      .status,
  ).toBe(401)
  expect(devEnvCapabilityCard(token + 'tampered')).toBeNull()
})

test('SSE encaminha configuração, comandos e saída, e cancelamento interrompe só o agente', async () => {
  const send = vi.fn((_name: string, _text: string, emit: (event: ChatEvent) => void, configuration?: unknown) => {
    expect(configuration).toBeDefined()
    emit({ type: 'tool', tool: 'npm run dev' })
    emit({ type: 'output', text: 'ready' })
    emit({ type: 'done' })
  })
  const abort = vi.fn(() => true)
  const handler = devEnvAgentSendHttp({
    send,
    abort,
    history: async () => ({ sessionId: null, entries: [] }),
    shutdown: async () => {},
  })
  const configuration = { docker: false, projects: [{ repo: 'api', port: 4100 }] }
  const response = await handler({
    method: 'POST',
    path: '/api/dev-env-agent/send',
    headers: {},
    query: new URLSearchParams(),
    body: { name: 'MB-1', text: 'Inicie', configuration },
  })
  const events: ChatEvent[] = []
  response.stream((event) => events.push(event))
  expect(send).toHaveBeenCalledWith('MB-1', 'Inicie', expect.any(Function), configuration)
  expect(events).toEqual([{ type: 'tool', tool: 'npm run dev' }, { type: 'output', text: 'ready' }, { type: 'done' }])
  response.cancel?.()
  expect(abort).toHaveBeenCalledWith('MB-1')
  send.mockImplementation(() => {
    throw new Error('Já há um agente trabalhando')
  })
  response.stream((event) => events.push(event))
  expect(events.at(-1)).toEqual({ type: 'done', error: 'Já há um agente trabalhando' })
})
