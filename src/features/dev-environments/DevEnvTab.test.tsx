// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DevEnvTab } from './DevEnvTab'
import type { Card } from '../../../shared/domain/cards'
import type { ChatEvent } from '../../../shared/contracts/chat'

const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  logs: vi.fn(),
  history: vi.fn(),
  preview: vi.fn(),
  send: vi.fn(),
  abort: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))
vi.mock('./dev-env-api', () => ({
  fetchDevEnv: api.fetch,
  fetchDevEnvLogs: api.logs,
  fetchDevEnvAgent: api.history,
  previewDevEnv: api.preview,
  sendDevEnvAgent: api.send,
  abortDevEnvAgent: api.abort,
  startConfiguredDevEnv: api.start,
}))
vi.mock('@/features/cards/model/card-commands', () => ({ stopDevEnv: api.stop, openDevEnv: vi.fn() }))
const card: Card = {
  id: 'MB-1',
  title: 'Card',
  description: '',
  flow: 'dificil',
  folder: '/tmp/card',
  status: 'code-review',
  createdAt: '2026-10-09',
  devEnv: {
    status: 'erro',
    error: 'Timeout esperando a porta 3333 responder',
    failure: { repo: 'api-garcom-digital', phase: 'Iniciando API' },
    apps: [{ repo: 'api-garcom-digital', kind: 'backend', source: 'worktree', port: 3333, status: 'erro' }],
  },
}
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  for (const mock of Object.values(api)) mock.mockReset()
  api.fetch.mockResolvedValue(card.devEnv)
  api.logs.mockResolvedValue({
    files: ['api-garcom-digital.log'],
    file: 'api-garcom-digital.log',
    content: 'Cannot connect to Redis',
    truncated: false,
  })
  api.history.mockResolvedValue({ entries: [], sessionId: null, executionRunning: false })
  api.preview.mockResolvedValue({
    docker: false,
    dockerContainers: [],
    platform: 'darwin',
    warnings: [],
    projects: [
      {
        repo: 'api-garcom-digital',
        kind: 'backend',
        source: 'worktree',
        directory: '/tmp/api',
        command: 'npm run dev',
        port: 4100,
        selected: true,
      },
    ],
  })
  api.send.mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
function button(text: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)
  if (!found) throw new Error(`Botão ausente: ${text}`)
  return found
}

test('mostra erro com contexto e logs sem iniciar agente ao abrir a aba', async () => {
  await act(async () => root.render(<DevEnvTab card={card} />))
  expect(host.textContent).toContain('api-garcom-digital não respondeu na porta 3333')
  expect(host.textContent).toContain('Etapa: Iniciando API')
  expect(host.textContent).toContain('Cannot connect to Redis')
  expect(host.querySelector('[aria-label="Terminal integrado do agente"]')).not.toBeNull()
  expect(api.send).not.toHaveBeenCalled()
  await act(async () => button('Diagnosticar com agente').click())
  expect(api.send).toHaveBeenCalledOnce()
  expect(api.send.mock.calls[0][1]).toContain('Diagnostique a falha')
})

test('configuração inicia pelo agente no terminal e renderiza comandos e saída', async () => {
  api.history.mockResolvedValue({
    entries: [
      { role: 'assistant', tool: 'npm run dev' },
      { role: 'assistant', output: 'Listening on 4100' },
    ],
    executionRunning: false,
  })
  await act(async () => root.render(<DevEnvTab card={card} />))
  await act(async () => button('Configurar ambiente').click())
  expect(api.send).not.toHaveBeenCalled()
  await act(async () => button('Iniciar com agente').click())
  expect(api.send).toHaveBeenCalledWith('MB-1', expect.stringContaining('Prepare e inicie'), expect.any(Function), {
    docker: false,
    projects: [{ repo: 'api-garcom-digital', port: 4100 }],
  })
  expect(api.start).not.toHaveBeenCalled()
  expect(host.querySelector('[role="log"]')?.textContent).toContain('$ npm run dev')
  expect(host.querySelector('[role="log"]')?.textContent).toContain('Listening on 4100')
})

test('permite acompanhar uma execução e interromper o agente pelo terminal', async () => {
  let complete: () => void = () => {}
  api.send.mockImplementation(
    (_name: string, _text: string, emit: (event: ChatEvent) => void) =>
      new Promise<void>((resolve) => {
        complete = resolve
        emit({ type: 'tool', tool: 'node agent-control.mjs status' })
        emit({ type: 'output', text: 'Iniciando API' })
      }),
  )
  await act(async () => root.render(<DevEnvTab card={card} />))
  await act(async () => button('Diagnosticar com agente').click())
  expect(host.querySelector('[role="log"]')?.textContent).toContain('node agent-control.mjs status')
  expect(host.querySelector('[role="log"]')?.textContent).toContain('Iniciando API')
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Interromper agente"]')!.click())
  expect(api.abort).toHaveBeenCalledWith('MB-1')
  expect(api.stop).not.toHaveBeenCalled()
  await act(async () => complete())
})
