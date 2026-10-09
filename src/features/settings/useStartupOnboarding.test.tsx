// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useStartupOnboarding } from './useStartupOnboarding'

const api = vi.hoisted(() => ({ fetchMegaBrainSettings: vi.fn(), fetchDetectedEditors: vi.fn() }))
vi.mock('../cards/api/card-detail-api', () => api)
let root: Root
let host: HTMLDivElement
let state: ReturnType<typeof useStartupOnboarding>
function Harness() {
  state = useStartupOnboarding()
  return null
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.resetAllMocks()
  localStorage.clear()
  host = document.createElement('div')
  root = createRoot(host)
  api.fetchMegaBrainSettings.mockResolvedValue({ general: { onboardingCompleted: true } })
  api.fetchDetectedEditors.mockResolvedValue({ editors: [], scope: 'fixture' })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
const render = () => act(async () => root.render(<Harness />))

test('completed onboarding skips editor discovery', async () => {
  localStorage.setItem('mega-brain-onboarding-tour-v1', 'done')
  await render()
  expect(api.fetchDetectedEditors).not.toHaveBeenCalled()
  expect(state.onboarding).toBeNull()
})

test.each([true, false])('unfinished local tour still discovers editors (backend completed=%s)', async (completed) => {
  api.fetchMegaBrainSettings.mockResolvedValue({ general: { onboardingCompleted: completed } })
  await render()
  expect(api.fetchDetectedEditors).toHaveBeenCalledOnce()
  expect(state.onboarding?.editors.scope).toBe('fixture')
  await act(async () => state.completeOnboarding())
  expect(state.onboarding).toBeNull()
})

test('incomplete backend onboarding is preserved even when local tour is done', async () => {
  localStorage.setItem('mega-brain-onboarding-tour-v1', 'done')
  api.fetchMegaBrainSettings.mockResolvedValue({ general: { onboardingCompleted: false } })
  api.fetchDetectedEditors.mockRejectedValue(new Error('discovery failed'))
  await render()
  expect(state.onboarding?.editors).toEqual({ editors: [], scope: 'máquina do backend' })
})

test('unmount before settings arrive prevents a late discovery request', async () => {
  let resolve!: (value: unknown) => void
  api.fetchMegaBrainSettings.mockReturnValue(
    new Promise((finish) => {
      resolve = finish
    }),
  )
  await render()
  await act(async () => root.render(null))
  await act(async () => resolve({ general: { onboardingCompleted: false } }))
  expect(api.fetchDetectedEditors).not.toHaveBeenCalled()
})
