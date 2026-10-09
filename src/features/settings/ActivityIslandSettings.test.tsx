// @vitest-environment jsdom
import { act, createRef, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ActivityIslandSettings, type ActivityIslandSettingsHandle } from './ActivityIslandSettings'
import { DEFAULT_ISLAND_DISPLAY, type IslandDisplaySettings } from '../../../shared/domain/activity-island'

const mocks = vi.hoisted(() => ({ requestJson: vi.fn(), invoke: vi.fn() }))
vi.mock('@/shared/api/request-json', () => ({ requestJson: mocks.requestJson }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
let island: RefObject<ActivityIslandSettingsHandle | null>
let root: Root
let host: HTMLDivElement
let server: IslandDisplaySettings
type RequestOptions = { method?: string; body?: Partial<IslandDisplaySettings> }

function requests() {
  return mocks.requestJson.mock.calls.filter((call) => call[2]?.method === 'PATCH')
}
function checkbox(label: string) {
  const field = [...host.querySelectorAll('label')].find((element) => element.textContent === label)
  expect(field, label).toBeTruthy()
  return field!.querySelector<HTMLInputElement>('input')!
}
function button(label: string) {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
}
async function tick(ms = 150) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
async function setValue(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  island = createRef<ActivityIslandSettingsHandle>()
  server = { ...DEFAULT_ISLAND_DISPLAY }
  mocks.requestJson.mockReset()
  mocks.invoke.mockReset()
  mocks.requestJson.mockImplementation(async (path: string, _message: string, options?: RequestOptions) => {
    if (path === '/api/codex/profiles')
      return {
        profiles: [
          { id: 'personal', name: 'Pessoal', home: '/Users/test/.codex', color: '#64B8FF' },
          { id: 'work', name: 'Trabalho', home: '/Users/test/.codex-work', color: '#73D99A' },
        ],
        activeId: 'personal',
        discovered: [],
      }
    if (options?.method === 'PATCH') server = { ...server, ...options.body }
    return { ...server }
  })
  mocks.invoke.mockResolvedValue([])
  await act(async () => root.render(<ActivityIslandSettings ref={island} />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})

test('initial loading and external synchronization do not save unchanged settings', async () => {
  expect(checkbox('Ativar ilha dinâmica').checked).toBe(true)
  expect(host.textContent).not.toContain('Aplicar à ilha')
  await tick(2000)
  await act(async () => button('Restaurar padrões da ilha').click())
  await tick()
  expect(requests()).toHaveLength(0)
  expect(host.querySelector('fieldset')?.disabled).toBe(false)
})

test('switches autosave only changed keys after a short pause, including false values', async () => {
  await act(async () => {
    checkbox('Ativar ilha dinâmica').click()
    checkbox('Sons dos agentes e tarefas').click()
  })
  expect(host.querySelector('[role=status]')?.textContent).toBe('Salvando…')
  await tick(149)
  expect(requests()).toHaveLength(0)
  await tick(1)
  expect(requests()).toHaveLength(1)
  expect(requests()[0]).toEqual([
    '/api/activity-island/settings',
    expect.any(String),
    {
      method: 'PATCH',
      body: { enabled: false, taskSounds: false },
    },
  ])
  expect(host.querySelector('[role=status]')?.textContent).toContain('Salvo')
})

test('new changes remain editable during a save and are serialized without an old response overwriting them', async () => {
  const first = deferred<IslandDisplaySettings>()
  mocks.requestJson.mockImplementationOnce(() => first.promise)
  await act(async () => checkbox('Ativar ilha dinâmica').click())
  await tick()
  expect(requests()).toHaveLength(1)
  expect(host.querySelector('fieldset')?.disabled).toBe(false)
  await act(async () => {
    checkbox('Sons dos agentes e tarefas').click()
    checkbox('Ativar ilha dinâmica').click()
  })
  await tick()
  expect(requests()).toHaveLength(1)
  server = { ...server, enabled: false }
  await act(async () => first.resolve({ ...server }))
  expect(checkbox('Ativar ilha dinâmica').checked).toBe(true)
  expect(checkbox('Sons dos agentes e tarefas').checked).toBe(false)
  await tick()
  expect(requests()).toHaveLength(2)
  expect(requests()[1][2].body).toEqual({ taskSounds: false, enabled: true })
  expect(server.enabled).toBe(true)
  expect(server.taskSounds).toBe(false)
})

test('failed saves preserve local preferences through polling and offer a working retry', async () => {
  mocks.requestJson.mockRejectedValueOnce(new Error('Sem conexão'))
  await act(async () => checkbox('Ativar ilha dinâmica').click())
  await tick()
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Sem conexão')
  expect(checkbox('Ativar ilha dinâmica').checked).toBe(false)
  await tick(1000)
  expect(checkbox('Ativar ilha dinâmica').checked).toBe(false)
  expect(requests()).toHaveLength(1)
  await act(async () => button('Tentar salvar novamente').click())
  expect(requests()).toHaveLength(2)
  expect(requests()[1][2].body).toEqual({ enabled: false })
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(server.enabled).toBe(false)
})

test('external speaker changes synchronize while pending local fields remain intact', async () => {
  await tick(900)
  server.taskSounds = false
  await act(async () => checkbox('Ativar ilha dinâmica').click())
  await tick(100)
  expect(checkbox('Sons dos agentes e tarefas').checked).toBe(false)
  expect(checkbox('Ativar ilha dinâmica').checked).toBe(false)
  expect(requests()).toHaveLength(0)
  await tick(50)
  expect(requests()[0][2].body).toEqual({ enabled: false })
  expect(server.taskSounds).toBe(false)
})

test('a stale polling response cannot roll back a completed save', async () => {
  const oldServer = { ...server }
  const poll = deferred<IslandDisplaySettings>()
  mocks.requestJson.mockImplementationOnce(() => poll.promise)
  await tick(1000)
  await act(async () => checkbox('Ativar ilha dinâmica').click())
  await tick()
  expect(server.enabled).toBe(false)
  await act(async () => poll.resolve(oldServer))
  expect(checkbox('Ativar ilha dinâmica').checked).toBe(false)
})

test('personalization updates the preview immediately and restores only changed fields', async () => {
  await setValue('Tamanho do mascote', '32')
  await setValue('Cor: Aguardando resposta', '#123456')
  await act(async () => button('Prévia: Aguardando resposta').click())
  const pet = host.querySelector<SVGElement>('.island-pet-preview')!
  expect(pet.getAttribute('width')).toBe('32')
  expect(pet.style.color).toBe('rgb(18, 52, 86)')
  expect(host.textContent).toContain('Qual abordagem devo seguir?')
  await tick()
  expect(requests()[0][2].body).toEqual({ petSize: 32, waitingColor: '#123456' })
  await act(async () => button('Restaurar padrões da ilha').click())
  await tick()
  expect(requests()[1][2].body).toEqual({
    petSize: DEFAULT_ISLAND_DISPLAY.petSize,
    waitingColor: DEFAULT_ISLAND_DISPLAY.waitingColor,
  })
  expect(pet.getAttribute('width')).toBe('24')
})

test('a missing monitor command does not prevent settings from loading', async () => {
  await act(async () => root.unmount())
  root = createRoot(host)
  mocks.invoke.mockRejectedValueOnce(new Error('No monitor command'))
  await act(async () => root.render(<ActivityIslandSettings ref={island} />))
  expect(host.querySelector('fieldset')?.disabled).toBe(false)
})

test('changing tabs flushes the last debounced edit', async () => {
  await act(async () => checkbox('Sons dos agentes e tarefas').click())
  expect(requests()).toHaveLength(0)
  await act(async () => root.unmount())
  expect(requests()).toHaveLength(1)
  expect(server.taskSounds).toBe(false)
  root = createRoot(host)
})

test('profile visibility and identification autosave independently from profile definitions', async () => {
  const work = host.querySelector<HTMLInputElement>('input[aria-label="Mostrar Trabalho na ilha"]')!
  expect(work.checked).toBe(true)
  await act(async () => {
    work.click()
    checkbox('Mostrar identificação do perfil na ilha').click()
  })
  await tick()
  expect(requests()[0][2].body).toEqual({ hiddenCodexProfileIds: ['work'], showProfileBadge: false })
  expect(mocks.requestJson.mock.calls.some((call) => call[2]?.method === 'PUT')).toBe(false)
  expect(work.checked).toBe(false)
  await act(async () => work.click())
  await tick()
  expect(requests()[1][2].body).toEqual({ hiddenCodexProfileIds: [] })
})

test('externally updated profile visibility is synchronized without creating a save', async () => {
  server.hiddenCodexProfileIds = ['personal']
  server.showProfileBadge = false
  await tick(1000)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Mostrar Pessoal na ilha"]')?.checked).toBe(false)
  expect(checkbox('Mostrar identificação do perfil na ilha').checked).toBe(false)
  expect(requests()).toHaveLength(0)
})

test('explicit save flushes the last edit immediately instead of waiting for debounce', async () => {
  await act(async () => checkbox('Ativar ilha dinâmica').click())
  expect(requests()).toHaveLength(0)
  let saved = false
  await act(async () => {
    saved = await island.current!.save()
  })
  expect(saved).toBe(true)
  expect(requests()).toHaveLength(1)
  expect(server.enabled).toBe(false)
  await tick()
  expect(requests()).toHaveLength(1)
})

test('explicit save waits for an active request and drains newer changes without duplicating it', async () => {
  const first = deferred<IslandDisplaySettings>()
  mocks.requestJson.mockImplementationOnce(() => first.promise)
  await act(async () => checkbox('Ativar ilha dinâmica').click())
  await tick()
  await act(async () => checkbox('Sons dos agentes e tarefas').click())
  let completed = false
  let saving!: Promise<boolean>
  await act(async () => {
    saving = island.current!.save().then((success) => {
      completed = true
      return success
    })
  })
  expect(completed).toBe(false)
  expect(requests()).toHaveLength(1)
  server.enabled = false
  await act(async () => {
    first.resolve({ ...server })
    await saving
  })
  expect(await saving).toBe(true)
  expect(completed).toBe(true)
  expect(requests()).toHaveLength(2)
  expect(requests()[1][2].body).toEqual({ taskSounds: false })
  expect(server.taskSounds).toBe(false)
})

test('explicit save reports failure and retries the preserved preferences', async () => {
  await act(async () => checkbox('Ativar ilha dinâmica').click())
  mocks.requestJson.mockRejectedValueOnce(new Error('Sem conexão'))
  let success = true
  await act(async () => {
    success = await island.current!.save()
  })
  expect(success).toBe(false)
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Sem conexão')
  await act(async () => {
    success = await island.current!.save()
  })
  expect(success).toBe(true)
  expect(server.enabled).toBe(false)
  expect(requests()).toHaveLength(2)
})
