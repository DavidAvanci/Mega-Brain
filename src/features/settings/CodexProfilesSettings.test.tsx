// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CodexProfilesSettings } from './CodexProfilesSettings'
import type { CodexProfiles, CodexProfilesResponse } from '../../../shared/domain/codex-profiles'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn() }))
vi.mock('@/shared/api/request-json', () => ({ requestJson: mocks.requestJson }))
let host: HTMLDivElement
let root: Root
let server: CodexProfilesResponse

function button(label: string) {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
}
function input(label: string) {
  return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
}
async function setInput(label: string, value: string) {
  const field = input(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
function saves() {
  return mocks.requestJson.mock.calls.filter((call) => call[2]?.method === 'PUT')
}

beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  server = {
    profiles: [{ id: 'personal', name: 'Pessoal', home: '/Users/test/.codex', color: '#64B8FF' }],
    activeId: 'personal',
    discovered: [{ name: 'Trabalho', home: '/Users/test/.codex-work' }],
  }
  mocks.requestJson.mockReset()
  mocks.requestJson.mockImplementation(
    async (_path: string, _fallback: string, options?: { method: string; body: CodexProfiles }) => {
      if (options?.method === 'PUT') server = { ...options.body, discovered: server.discovered }
      return structuredClone(server)
    },
  )
  await act(async () => root.render(<CodexProfilesSettings />))
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

test('adds a discovered profile, chooses it for new launches and persists editable labels and colors', async () => {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Adicionar perfil encontrado"]')!
  await act(async () => {
    select.value = '/Users/test/.codex-work'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await setInput('Nome do perfil Trabalho', 'Takeat')
  await setInput('Cor do perfil Takeat', '#123456')
  await act(async () => input('Usar Takeat em novas execuções').click())
  expect(saves()).toHaveLength(0)
  await act(async () => button('Salvar perfis do Codex').click())
  expect(saves()).toHaveLength(1)
  expect(server.profiles[1]).toEqual({
    id: expect.any(String),
    name: 'Takeat',
    home: '/Users/test/.codex-work',
    color: '#123456',
  })
  expect(server.activeId).toBe(server.profiles[1].id)
  expect(host.textContent).toContain('Perfis salvos')
})

test('removing the selected profile falls back to a remaining profile and preserves stable identifiers', async () => {
  await act(async () => button('Adicionar perfil do Codex').click())
  await setInput('Pasta do perfil Novo perfil', '/Users/test/.codex-alt')
  await act(async () => {
    input('Usar Novo perfil em novas execuções').click()
    button('Remover perfil Novo perfil').click()
    button('Salvar perfis do Codex').click()
  })
  expect(server.activeId).toBe('personal')
  expect(server.profiles.map((profile) => profile.id)).toEqual(['personal'])
  expect(button('Remover perfil Pessoal').disabled).toBe(true)
})

test('missing required fields remain editable and unsaved', async () => {
  await act(async () => button('Adicionar perfil do Codex').click())
  await act(async () => button('Salvar perfis do Codex').click())
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Preencha o nome e a pasta de cada perfil.')
  expect(saves()).toHaveLength(0)
  await setInput('Pasta do perfil Novo perfil', '/Users/test/.codex-alt')
  await act(async () => button('Salvar perfis do Codex').click())
  expect(server.profiles).toHaveLength(2)
})

test('save failures retain local edits through polling and retry the same profile payload', async () => {
  await setInput('Nome do perfil Pessoal', 'Minha conta')
  mocks.requestJson.mockRejectedValueOnce(new Error('Sem conexão'))
  await act(async () => button('Salvar perfis do Codex').click())
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Sem conexão')
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(input('Nome do perfil Minha conta').value).toBe('Minha conta')
  expect(saves()).toHaveLength(1)
  await act(async () => button('Tentar salvar perfis novamente').click())
  expect(server.profiles[0].name).toBe('Minha conta')
  expect(saves()[1][2].body).toEqual(saves()[0][2].body)
  expect(host.querySelector('[role=alert]')).toBeNull()
})

test('external changes synchronize while clean and never replace a local draft', async () => {
  server.profiles[0].name = 'Conta externa'
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(input('Nome do perfil Conta externa')).toBeTruthy()
  await setInput('Nome do perfil Conta externa', 'Nome local')
  server.profiles[0].name = 'Outra alteração'
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(input('Nome do perfil Nome local').value).toBe('Nome local')
  expect(saves()).toHaveLength(0)
})

test('a load failure offers retry without an empty profile write', async () => {
  await act(async () => root.unmount())
  root = createRoot(host)
  mocks.requestJson.mockRejectedValueOnce(new Error('Backend indisponível'))
  await act(async () => root.render(<CodexProfilesSettings />))
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Backend indisponível')
  await act(async () => button('Tentar salvar perfis novamente').click())
  expect(input('Nome do perfil Pessoal')).toBeTruthy()
  expect(saves()).toHaveLength(0)
})

test('notifies profile consumers only after a successful save without including profile data', async () => {
  const changed = vi.fn()
  window.addEventListener('megabrain:codex-profiles-changed', changed)
  try {
    await setInput('Nome do perfil Pessoal', 'Nova identificação')
    expect(changed).not.toHaveBeenCalled()
    mocks.requestJson.mockRejectedValueOnce(new Error('Sem conexão'))
    await act(async () => button('Salvar perfis do Codex').click())
    expect(changed).not.toHaveBeenCalled()
    await act(async () => button('Tentar salvar perfis novamente').click())
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls[0][0]).toBeInstanceOf(Event)
    expect('detail' in changed.mock.calls[0][0]).toBe(false)
  } finally {
    window.removeEventListener('megabrain:codex-profiles-changed', changed)
  }
})
