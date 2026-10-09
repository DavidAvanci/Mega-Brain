// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { UsageMeter } from './UsageMeter'
import type { ClaudeUsage } from '../shared/contracts/usage'

const mocks = vi.hoisted(() => ({ json: vi.fn() }))
vi.mock('./shared/api/api-client', () => ({ apiClient: () => ({ json: mocks.json }) }))
let host: HTMLDivElement
let root: Root

function usage(id = 'personal', name = 'Pessoal', utilization = 32): ClaudeUsage {
  return {
    codexProfileId: id,
    codexProfileName: name,
    fiveHour: { utilization, resetsAt: null },
    sevenDay: { utilization: utilization + 10, resetsAt: null },
    fable: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T15:00:00Z'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  // jsdom does not expose these newer AbortSignal static methods consistently.
  vi.stubGlobal('AbortSignal', {
    any: (signals: AbortSignal[]) => signals[0],
    timeout: () => new AbortController().signal,
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mocks.json.mockReset()
  mocks.json.mockResolvedValue(usage())
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

test('labels Codex consumption with the active profile and displays its current windows', async () => {
  await act(async () => root.render(<UsageMeter provider="codex" layout="stacked" />))
  expect(host.querySelector('[title="Consumo do perfil Pessoal"]')?.textContent).toBe('Pessoal')
  expect(host.textContent).toContain('32%')
  expect(host.textContent).toContain('42%')
  expect(host.querySelector('[role=status]')).toBeNull()
  expect(mocks.json).toHaveBeenCalledWith('/api/codex/usage', expect.objectContaining({ signal: expect.anything() }))
})

test('a successful unavailable response from another profile clears all previous percentages', async () => {
  await act(async () => root.render(<UsageMeter provider="codex" />))
  expect(host.textContent).toContain('32%')
  mocks.json.mockResolvedValueOnce({
    codexProfileId: 'work',
    codexProfileName: 'Trabalho',
    fiveHour: null,
    sevenDay: null,
    fable: null,
    unavailableReason: 'Faça login no perfil Trabalho.',
  } satisfies ClaudeUsage)
  await act(async () => window.dispatchEvent(new Event('megabrain:codex-profiles-changed')))
  expect(host.querySelector('[title="Consumo do perfil Trabalho"]')?.textContent).toBe('Trabalho')
  expect(host.textContent).not.toContain('Pessoal')
  expect(host.textContent).not.toContain('%')
  expect(host.querySelector('[role=status]')?.textContent).toBe('Faça login no perfil Trabalho.')
})

test('profile save notifications reload Codex consumption immediately without waiting for the poll', async () => {
  await act(async () => root.render(<UsageMeter provider="codex" />))
  mocks.json.mockResolvedValueOnce(usage('work', 'Trabalho', 65))
  await act(async () => window.dispatchEvent(new Event('megabrain:codex-profiles-changed')))
  expect(mocks.json).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('Trabalho')
  expect(host.textContent).toContain('65%')
  expect(host.textContent).not.toContain('32%')
})

test('notifications during an existing fetch queue a fresh reload and coalesce a burst of changes', async () => {
  const initial = deferred<ClaudeUsage>()
  const latest = deferred<ClaudeUsage>()
  mocks.json.mockReturnValueOnce(initial.promise).mockReturnValueOnce(latest.promise)
  await act(async () => root.render(<UsageMeter provider="codex" />))
  expect(host.textContent).toBe('Carregando consumo…')
  await act(async () => {
    window.dispatchEvent(new Event('megabrain:codex-profiles-changed'))
    window.dispatchEvent(new Event('megabrain:codex-profiles-changed'))
    window.dispatchEvent(new Event('megabrain:codex-profiles-changed'))
  })
  expect(mocks.json).toHaveBeenCalledTimes(1)
  await act(async () => initial.resolve(usage()))
  expect(mocks.json).toHaveBeenCalledTimes(2)
  await act(async () => latest.resolve(usage('work', 'Trabalho', 71)))
  expect(mocks.json).toHaveBeenCalledTimes(2)
  expect(host.textContent).toContain('Trabalho')
  expect(host.textContent).toContain('71%')
  expect(host.textContent).not.toContain('32%')
})

test('Claude does not subscribe to Codex profile notifications', async () => {
  await act(async () => root.render(<UsageMeter provider="claude" />))
  expect(host.textContent).not.toContain('Pessoal')
  await act(async () => window.dispatchEvent(new Event('megabrain:codex-profiles-changed')))
  expect(mocks.json).toHaveBeenCalledTimes(1)
  expect(mocks.json).toHaveBeenCalledWith('/api/claude/usage', expect.anything())
})

test.each(['codex', 'claude'] as const)(
  'shows visible reset countdowns and remaining quota for %s',
  async (provider) => {
    mocks.json.mockResolvedValue({
      ...usage(),
      fiveHour: { utilization: 32, resetsAt: '2026-10-08T17:18:00Z' },
      sevenDay: { utilization: 42, resetsAt: '2026-10-11T19:20:00Z' },
    } satisfies ClaudeUsage)
    await act(async () => root.render(<UsageMeter provider={provider} layout="stacked" />))
    expect(host.textContent).toContain('32% usado')
    expect(host.textContent).toContain('68% disponível')
    expect(host.textContent).toContain('Reseta em 2h 18min')
    expect(host.textContent).toContain('Reseta em 3d 4h 20min')
    const meters = host.querySelectorAll('[role=meter]')
    expect(meters).toHaveLength(2)
    expect(meters[0].getAttribute('aria-label')).toContain(provider === 'codex' ? 'Codex' : 'Claude')
    expect(meters[0].getAttribute('aria-valuenow')).toBe('32')
    expect(meters[0].getAttribute('aria-valuetext')).toContain('Reseta em 2h 18min')
    expect(host.querySelector('time')?.dateTime).toBe('2026-10-08T17:18:00.000Z')
  },
)

test('updates the countdown between API polls without an extra request', async () => {
  mocks.json.mockResolvedValue({
    ...usage(),
    fiveHour: { utilization: 32, resetsAt: '2026-10-08T15:03:00Z' },
  } satisfies ClaudeUsage)
  await act(async () => root.render(<UsageMeter provider="codex" layout="stacked" />))
  expect(host.textContent).toContain('Reseta em 3min')
  await act(async () => vi.advanceTimersByTime(15_000))
  expect(host.textContent).toContain('Reseta em 2min')
  expect(mocks.json).toHaveBeenCalledTimes(1)
  await act(async () => vi.advanceTimersByTime(45_000))
  expect(mocks.json).toHaveBeenCalledTimes(2)
})

test('keeps expired readings marked as awaiting an update when the API refresh fails', async () => {
  mocks.json.mockResolvedValueOnce({
    ...usage(),
    fiveHour: { utilization: 100, resetsAt: '2026-10-08T15:00:30Z' },
  } satisfies ClaudeUsage)
  await act(async () => root.render(<UsageMeter provider="codex" />))
  expect(host.textContent).toContain('Reseta em < 1min')
  await act(async () => vi.advanceTimersByTime(30_000))
  expect(host.textContent).toContain('Aguardando atualização')
  expect(host.textContent).toContain('100% usado')
  mocks.json.mockRejectedValueOnce(new Error('offline'))
  await act(async () => vi.advanceTimersByTime(30_000))
  expect(host.textContent).toContain('Aguardando atualização')
  expect(host.querySelector('[role=status]')?.textContent).toBe('Dados desatualizados')
  expect(host.querySelector('[role=meter]')?.getAttribute('aria-valuenow')).toBe('100')
})

test('recovers the current countdown and consumption when the window regains focus', async () => {
  mocks.json.mockResolvedValueOnce({
    ...usage(),
    fiveHour: { utilization: 32, resetsAt: '2026-10-08T15:03:00Z' },
  } satisfies ClaudeUsage)
  await act(async () => root.render(<UsageMeter provider="claude" />))
  vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
  mocks.json.mockResolvedValueOnce({
    ...usage(),
    fiveHour: { utilization: 2, resetsAt: '2026-10-08T20:00:00Z' },
  } satisfies ClaudeUsage)
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(host.textContent).toContain('Reseta em 4h')
  expect(host.textContent).toContain('2% usado')
  expect(mocks.json).toHaveBeenCalledTimes(2)
})

test('handles unknown reset dates and the additional Claude model window', async () => {
  mocks.json.mockResolvedValue({
    ...usage(),
    fiveHour: { utilization: 0, resetsAt: null },
    sevenDay: { utilization: 42, resetsAt: 'not-a-date' },
    fable: { utilization: 75, resetsAt: '2026-10-10T15:00:00Z' },
  } satisfies ClaudeUsage)
  await act(async () => root.render(<UsageMeter provider="claude" layout="stacked" />))
  expect(host.textContent?.match(/Reset não informado/g)).toHaveLength(2)
  expect(host.textContent).not.toContain('Invalid Date')
  expect(host.textContent).toContain('100% disponível')
  expect(host.textContent).toContain('Modelo')
  expect(host.textContent).toContain('Reseta em 2d')
  expect(host.querySelectorAll('time')).toHaveLength(1)
  expect(host.querySelectorAll('[role=meter]')).toHaveLength(3)
})

test('unmounting removes the profile listener and aborts its pending request', async () => {
  const pending = deferred<ClaudeUsage>()
  mocks.json.mockReturnValueOnce(pending.promise)
  await act(async () => root.render(<UsageMeter provider="codex" />))
  const signal = mocks.json.mock.calls[0][1].signal as AbortSignal
  await act(async () => root.unmount())
  expect(signal.aborted).toBe(true)
  await act(async () => {
    window.dispatchEvent(new Event('megabrain:codex-profiles-changed'))
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(60_000)
    pending.resolve(usage())
  })
  expect(mocks.json).toHaveBeenCalledTimes(1)
  root = createRoot(host)
})
