// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DiffTab } from './DiffTab'

const mocks = vi.hoisted(() => ({ fetchDiff: vi.fn(), fetchStandardDiff: vi.fn(), startDiff: vi.fn() }))
vi.mock('../api/card-detail-api', () => mocks)
vi.mock('@/theme', () => ({ useTheme: () => 'light' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@git-diff-view/react', () => ({
  DiffFile: {},
  DiffModeEnum: { Split: 1, Unified: 2 },
  DiffView: 'div',
  highlighter: { maxLineToIgnoreSyntax: 1000 },
}))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({ getTotalSize: () => 0, getVirtualItems: () => [], measureElement: () => {} }),
}))

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  mocks.startDiff.mockResolvedValue({ status: 'running', started: true })
  mocks.fetchStandardDiff.mockResolvedValue([])
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})

async function openDiff() {
  await act(async () => root.render(<DiffTab cardId="card-1" />))
}

async function clickButton(label: string) {
  const button = [...host.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
  expect(button).toBeDefined()
  await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

test('opening a card without a review does not generate Smart Diff', async () => {
  mocks.fetchDiff.mockResolvedValue({ status: 'error', started: false, error: 'O diff ainda não foi gerado' })
  await openDiff()
  expect(mocks.fetchDiff).toHaveBeenCalledWith('card-1')
  expect(mocks.startDiff).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Smart Diff ainda não gerado')

  await clickButton('Gerar Smart Diff')
  expect(mocks.startDiff).toHaveBeenCalledOnce()
  expect(mocks.startDiff).toHaveBeenCalledWith('card-1', false)
})

test('opening a completed review only reads it; its button explicitly regenerates', async () => {
  mocks.fetchDiff.mockResolvedValue({
    status: 'ready',
    started: true,
    result: { schemaVersion: 1, generatedAt: '2026-09-27T00:00:00.000Z', repositories: [] },
  })
  await openDiff()
  expect(mocks.startDiff).not.toHaveBeenCalled()

  await clickButton('Gerar novo Smart Diff')
  expect(mocks.startDiff).toHaveBeenCalledOnce()
  expect(mocks.startDiff).toHaveBeenCalledWith('card-1', true)
})
