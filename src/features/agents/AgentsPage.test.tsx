// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AgentsPage } from './AgentsPage'
import type { AgentSession } from '../../../shared/domain/agents'

const mocks = vi.hoisted(() => ({ sessions: [] as AgentSession[], refresh: vi.fn(), stop: vi.fn() }))
vi.mock('./model/agents-state', () => ({
  useAgentSessions: () => ({ sessions: mocks.sessions, loaded: true, refreshing: false, error: null }),
  isAgentSessionActive: (session: AgentSession) => ['rodando', 'aguardando'].includes(session.status),
  refreshAgentSessions: mocks.refresh,
  stopAgentSession: mocks.stop,
}))
let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const base: AgentSession = {
    id: 'shared-session',
    provider: 'codex',
    status: 'rodando',
    cwd: '/project',
    title: 'Desenvolvimento',
    startedAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T11:00:00Z',
    pid: 42,
  }
  mocks.sessions = [
    {
      ...base,
      title: 'Tarefa pessoal',
      codexProfileId: 'personal',
      codexProfileName: 'Pessoal',
      codexProfileColor: '#64B8FF',
    },
    {
      ...base,
      title: 'Tarefa de trabalho',
      codexProfileId: 'work',
      codexProfileName: 'Trabalho',
      codexProfileColor: '#73D99A',
      pid: 43,
    },
    {
      ...base,
      id: 'claude-session',
      provider: 'claude',
      title: 'Sessão do Claude',
      status: 'concluido',
      pid: undefined,
    },
  ]
  mocks.refresh.mockReset()
  mocks.stop.mockReset()
  await act(async () => root.render(<AgentsPage cards={[]} onOpenCard={() => {}} />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

test('shows profile badges and compact single rows for sessions with the same session ID', () => {
  expect(host.querySelectorAll('article')).toHaveLength(3)
  const badge = host.querySelector('[aria-label="Perfil: Trabalho"]')!
  expect(badge.textContent).toBe('Trabalho')
  expect(badge.querySelector<HTMLElement>('[aria-hidden]')?.style.backgroundColor).toBe('rgb(115, 217, 154)')
  expect([...host.querySelectorAll('article')].every((row) => row.className.includes('p-3'))).toBe(true)
  expect(host.textContent).toContain('Tarefa pessoal')
  expect(host.textContent).toContain('Tarefa de trabalho')
})

test('filters active and recent sessions by profile and provider', async () => {
  const filter = host.querySelector<HTMLSelectElement>('[aria-label="Filtrar por perfil"]')!
  await act(async () => {
    filter.value = 'codex:work'
    filter.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(host.querySelectorAll('article')).toHaveLength(1)
  expect(host.textContent).toContain('Tarefa de trabalho')
  expect(host.textContent).not.toContain('Tarefa pessoal')
  expect(host.textContent).not.toContain('Sessão do Claude')
  await act(async () => {
    filter.value = 'claude'
    filter.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(host.querySelectorAll('article')).toHaveLength(1)
  expect(host.textContent).toContain('Sessão do Claude')
  expect(host.textContent).toContain('Nenhum agente rodando agora')
})

test('refresh and stop controls have accessible icon labels', async () => {
  const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Atualizar agentes"]')!
  expect(refresh.textContent).toBe('')
  await act(async () => refresh.click())
  expect(mocks.refresh).toHaveBeenCalledWith(true)
  expect(host.querySelector('button[aria-label="Parar agente Tarefa de trabalho"]')).toBeTruthy()
})

test('stopping a session includes the profile when session IDs overlap', async () => {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Parar agente Tarefa de trabalho"]')!.click(),
  )
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Interromper agente',
  )!
  await act(async () => confirm.click())
  expect(mocks.stop).toHaveBeenCalledWith('shared-session', 'work')
})
