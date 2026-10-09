// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DevEnvTab } from './DevEnvTab'
import { CardChatPanel, type EnvironmentChatRequest } from '@/features/cards/ui/CardChatPanel'
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
vi.mock('@/features/chat/ChatTab', () => ({ ChatTab: () => <textarea aria-label="Mensagem de execução" /> }))
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

function Workspace({ current = card }: { current?: Card }) {
  const [running, setRunning] = useState(false)
  const [request, setRequest] = useState<EnvironmentChatRequest>()
  return (
    <>
      <DevEnvTab
        card={current}
        agentRunning={running}
        onEnvironmentChat={(text, configuration) =>
          setRequest((previous) => ({ id: (previous?.id ?? 0) + 1, cardId: current.id, text, configuration }))
        }
      />
      <CardChatPanel
        key={current.id}
        cardId={current.id}
        environmentRequest={request}
        onEnvironmentRunningChange={setRunning}
      />
    </>
  )
}

test('mostra erro com contexto e logs sem iniciar agente ao abrir a aba', async () => {
  await act(async () => root.render(<Workspace />))
  expect(host.textContent).toContain('api-garcom-digital não respondeu na porta 3333')
  expect(host.textContent).toContain('Etapa: Iniciando API')
  expect(host.textContent).toContain('Cannot connect to Redis')
  expect(host.querySelector('[aria-label="Terminal integrado do agente"]')).not.toBeNull()
  expect(api.send).not.toHaveBeenCalled()
  await act(async () => button('Diagnosticar com agente').click())
  expect(api.send).toHaveBeenCalledOnce()
  expect(api.send.mock.calls[0][1]).toContain('Diagnostique a falha')
  expect(host.querySelector('[aria-label="Conversas do card"] [aria-selected="true"]')?.textContent).toBe('Ambiente')
})

test('configuração inicia pelo agente no terminal e renderiza comandos e saída', async () => {
  api.history.mockResolvedValue({
    entries: [
      { role: 'assistant', tool: 'npm run dev' },
      { role: 'assistant', output: 'Listening on 4100' },
    ],
    executionRunning: false,
  })
  await act(async () => root.render(<Workspace />))
  await act(async () => button('Configurar ambiente').click())
  expect(api.send).not.toHaveBeenCalled()
  await act(async () => button('Iniciar com agente').click())
  expect(api.send).toHaveBeenCalledWith(
    'MB-1',
    expect.stringContaining('Prepare e inicie'),
    expect.any(Function),
    {
      docker: false,
      projects: [{ repo: 'api-garcom-digital', port: 4100 }],
    },
    { provider: 'claude', model: 'default' },
  )
  expect(api.start).not.toHaveBeenCalled()
  expect(host.querySelector('[role="log"]')?.textContent).toContain('npm run dev')
  expect(host.querySelector('[role="log"]')?.textContent).toContain('Listening on 4100')
})

test('permite acompanhar uma execução e interromper o agente pelo terminal', async () => {
  let complete: () => void = () => {}
  let output: (event: ChatEvent) => void = () => {}
  api.send.mockImplementation(
    (_name: string, _text: string, emit: (event: ChatEvent) => void) =>
      new Promise<void>((resolve) => {
        complete = resolve
        output = emit
        emit({ type: 'tool', tool: 'node agent-control.mjs status' })
        emit({ type: 'output', text: 'Iniciando API' })
      }),
  )
  await act(async () => root.render(<Workspace />))
  await act(async () => button('Diagnosticar com agente').click())
  expect(host.querySelector('[role="log"]')?.textContent).toContain('node agent-control.mjs status')
  expect(host.querySelector('[role="log"]')?.textContent).toContain('Iniciando API')
  await act(async () => button('Execuções').click())
  expect(host.querySelector('[role="log"]')?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
  await act(async () => output({ type: 'output', text: 'API respondeu na porta 4100' }))
  await act(async () => button('Ambiente').click())
  expect(host.querySelector('[role="log"]')?.textContent).toContain('API respondeu na porta 4100')
  expect(api.send).toHaveBeenCalledOnce()
  expect(api.abort).not.toHaveBeenCalled()
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Interromper agente"]')!.click())
  expect(api.abort).toHaveBeenCalledWith('MB-1')
  expect(api.stop).not.toHaveBeenCalled()
  await act(async () => complete())
})

test('mostra portas previstas mesmo antes da primeira inicialização', async () => {
  api.fetch.mockResolvedValue(null)
  await act(async () => root.render(<Workspace current={{ ...card, devEnv: undefined }} />))
  const table = host.querySelector('table[aria-label="Portas previstas e em execução"]')
  expect(table?.textContent).toContain('api-garcom-digital')
  expect(table?.textContent).toContain('4100')
  expect(table?.textContent).toContain('Previsto')
  expect(host.textContent).toContain('0 em execução · 1 prevista')
  expect(api.start).not.toHaveBeenCalled()
  expect(api.send).not.toHaveBeenCalled()
})

test('pedir ajuda muda de aba e mantém rascunhos ao alternar chats', async () => {
  await act(async () => root.render(<Workspace />))
  await act(async () => button('Pedir ao agente').click())
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Pedido ao agente do ambiente"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Investigue o Redis')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => button('Execuções').click())
  expect(textarea.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)
  await act(async () => button('Ambiente').click())
  expect(textarea.value).toBe('Investigue o Redis')
  expect(textarea.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false)
  expect(api.send).not.toHaveBeenCalled()
})
