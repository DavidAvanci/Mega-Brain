// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { parseTaskChecklist } from '../../../../shared/domain/task-checklist'
import { checklistJson } from '../../../../test/checklist-fixtures'
import { useCardDetail, type CardDetailState } from './useCardDetail'

const { fetchSection } = vi.hoisted(() => ({ fetchSection: vi.fn() }))
vi.mock('../api/card-detail-api', () => ({ fetchCardDetailSection: fetchSection }))
let root: Root
let host: HTMLDivElement
let state: CardDetailState

function Harness({ cardId = 'CARD-1', usage = false }: { cardId?: string; usage?: boolean }) {
  state = useCardDetail(cardId, 'TASK-CHECKLIST.json', usage)
  return <span>{state.error}</span>
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchSection.mockReset()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})

test('loads structured checklist data and clears it when switching to a card without tasks', async () => {
  const checklist = parseTaskChecklist(checklistJson([{ title: 'Implementar' }]))
  fetchSection.mockResolvedValueOnce({ checklist })
  await act(async () => root.render(<Harness />))
  expect(fetchSection).toHaveBeenCalledWith('CARD-1', 'checklist')
  expect(state.checklist).toEqual(checklist)
  expect(state.checklistLoaded).toBe(true)
  expect(state.files).toEqual({})
  fetchSection.mockResolvedValueOnce({ checklist: null })
  await act(async () => root.render(<Harness cardId="CARD-2" />))
  expect(state.checklist).toBeNull()
  expect(state.checklistLoaded).toBe(true)
})

test('usage refresh cannot hide an invalid checklist error and a corrected checklist recovers', async () => {
  fetchSection.mockImplementation((_id, section) =>
    section === 'checklist'
      ? Promise.reject(new Error('JSON inválido'))
      : Promise.resolve({ usage: null, usageBreakdown: [] }),
  )
  await act(async () => root.render(<Harness usage />))
  expect(state.error).toBe('JSON inválido')
  const checklist = parseTaskChecklist(checklistJson([{ state: 'blocked' }]))
  fetchSection.mockImplementation((_id, section) =>
    Promise.resolve(section === 'checklist' ? { checklist } : { usage: null, usageBreakdown: [] }),
  )
  await act(async () => {
    vi.advanceTimersByTime(5_000)
  })
  expect(state.error).toBeNull()
  expect(state.checklist).toEqual(checklist)
})
