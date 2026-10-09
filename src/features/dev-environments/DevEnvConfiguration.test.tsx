// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DevEnvConfiguration } from './DevEnvConfiguration'
import { DevEnvPanel } from './DevEnvPanel'
import type { DevEnvPreview } from '../../../shared/domain/dev-environments'
import type { Card } from '../../../shared/domain/cards'

const api = vi.hoisted(() => ({ preview: vi.fn(), start: vi.fn(), stop: vi.fn() }))
vi.mock('./dev-env-api', () => ({ previewDevEnv: api.preview, startConfiguredDevEnv: api.start }))
vi.mock('@/features/cards/model/card-commands', () => ({
  stopDevEnv: api.stop,
  openDevEnv: vi.fn(),
  openDevEnvAgent: vi.fn(),
}))

const preview: DevEnvPreview = {
  docker: false,
  dockerContainers: ['takeat_db', 'takeat_redis'],
  platform: 'darwin',
  warnings: [],
  projects: [
    {
      repo: 'api-garcom-digital',
      kind: 'backend',
      source: 'worktree',
      directory: '/tmp/card/backend',
      command: 'npm run dev',
      port: 3333,
      selected: true,
    },
    {
      repo: 'manager-area',
      kind: 'frontend',
      source: 'worktree',
      directory: '/tmp/card/frontend',
      command: 'npm run dev',
      port: 5173,
      selected: true,
    },
  ],
}
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.preview.mockReset().mockResolvedValue(preview)
  api.start.mockReset().mockResolvedValue(undefined)
  api.stop.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

function checkbox(label: string) {
  const element = document.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${label}"]`)
  if (!element) throw new Error(`Checkbox ausente: ${label}`)
  return element
}
function startButton() {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    /^Iniciar \d/.test(button.textContent ?? ''),
  )
  if (!element) throw new Error('Botão iniciar ausente')
  return element
}
async function port(repo: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="Porta de ${repo}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('resumo de ambientes abre a aba sem iniciar processos', async () => {
  const card: Card = {
    id: 'MB-1',
    title: 'Card',
    status: 'code-review',
    description: '',
    flow: 'dificil',
    folder: '/tmp/MB-1',
    createdAt: '2026-10-09T10:00:00Z',
  }
  const open = vi.fn()
  await act(async () => root.render(<DevEnvPanel card={card} onOpen={open} />))
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Abrir aba Ambientes"]')!
  await act(async () => button.click())
  expect(open).toHaveBeenCalledOnce()
  expect(api.preview).not.toHaveBeenCalled()
  expect(api.start).not.toHaveBeenCalled()
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () =>
    root.render(
      <DevEnvPanel
        onOpen={open}
        card={{
          ...card,
          devEnv: {
            status: 'erro',
            failure: { repo: 'api-garcom-digital' },
            error: 'Timeout esperando a porta 3333 responder',
            apps: [],
          },
        }}
      />,
    ),
  )
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Abrir aba Ambientes"]')!.click())
  expect(host.textContent).toContain('Ambiente com falha · api-garcom-digital')
  expect(host.textContent).not.toContain('Timeout')
  expect(open).toHaveBeenCalledTimes(2)
  expect(api.start).not.toHaveBeenCalled()
  expect(api.stop).not.toHaveBeenCalled()
})

test('iniciar com agente recebe a seleção e não dispara inicialização automática', async () => {
  const agent = vi.fn()
  await act(async () =>
    root.render(<DevEnvConfiguration cardId="MB-1" preview={preview} onClose={vi.fn()} onStartWithAgent={agent} />),
  )
  await act(async () => checkbox('Executar manager-area').click())
  await port('api-garcom-digital', '4100')
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Iniciar com agente')!
      .click(),
  )
  expect(agent).toHaveBeenCalledWith({ docker: false, projects: [{ repo: 'api-garcom-digital', port: 4100 }] })
  expect(api.start).not.toHaveBeenCalled()
})

test('envia só projetos marcados, porta editada e Docker desativado no macOS', async () => {
  const close = vi.fn()
  await act(async () => root.render(<DevEnvConfiguration cardId="MB-1" preview={preview} onClose={close} />))
  expect(checkbox('Iniciar containers Docker').getAttribute('aria-checked')).toBe('false')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('/tmp/card/backend')
  await act(async () => checkbox('Executar manager-area').click())
  await port('api-garcom-digital', '4100')
  expect(startButton().textContent).toBe('Iniciar 1 projeto')
  await act(async () => startButton().click())
  expect(api.start).toHaveBeenCalledWith('MB-1', {
    docker: false,
    projects: [{ repo: 'api-garcom-digital', port: 4100 }],
  })
  expect(close).toHaveBeenCalledOnce()
})

test('bloqueia portas inválidas ou duplicadas e seleção vazia', async () => {
  await act(async () => root.render(<DevEnvConfiguration cardId="MB-1" preview={preview} onClose={vi.fn()} />))
  await port('manager-area', '3333')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('porta diferente')
  expect(startButton().disabled).toBe(true)
  await port('manager-area', '70000')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('1 e 65535')
  await act(async () => checkbox('Executar manager-area').click())
  expect(startButton().disabled).toBe(false)
  await act(async () => checkbox('Executar api-garcom-digital').click())
  expect(startButton().disabled).toBe(true)
  expect(api.start).not.toHaveBeenCalled()
})

test('erro de inicialização preserva configuração para correção', async () => {
  api.start.mockRejectedValue(new Error('Porta ocupada'))
  const close = vi.fn()
  await act(async () => root.render(<DevEnvConfiguration cardId="MB-1" preview={preview} onClose={close} />))
  await act(async () => startButton().click())
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Porta ocupada')
  expect(close).not.toHaveBeenCalled()
  expect(startButton().disabled).toBe(false)
})

test('cancelar a configuração não inicia nem para o ambiente', async () => {
  const close = vi.fn()
  await act(async () => root.render(<DevEnvConfiguration cardId="MB-1" preview={preview} onClose={close} />))
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Cancelar')!
      .click(),
  )
  expect(close).toHaveBeenCalledOnce()
  expect(api.start).not.toHaveBeenCalled()
  expect(api.stop).not.toHaveBeenCalled()
})
