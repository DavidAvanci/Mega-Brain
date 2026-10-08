// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { MegaBrainSettings } from '../../../../shared/domain/settings'
import { fetchMegaBrainSettings } from '../api/card-detail-api'
import { NewCardDialog } from './NewCard'

vi.mock('../api/card-detail-api', () => ({ fetchMegaBrainSettings: vi.fn() }))
vi.mock('../model/card-commands', () => ({ createCard: vi.fn() }))
vi.mock('@hugeicons/react', () => ({ HugeiconsIcon: () => null }))
vi.mock('@hugeicons/core-free-icons', () => ({ PlusSignIcon: [] }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/input', () => ({ Input: 'input' }))
vi.mock('../model/useCardTriage', () => ({
  useCardTriage: () => ({ state: { status: 'idle' }, invalidate: vi.fn(), suggest: vi.fn() }),
}))
vi.mock('@/components/ui/dialog', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  return {
    Dialog: Wrapper,
    DialogContent: Wrapper,
    DialogDescription: Wrapper,
    DialogHeader: Wrapper,
    DialogTitle: Wrapper,
  }
})
vi.mock('@/components/RepositoryMentionTextarea', () => ({ RepositoryMentionTextarea: () => <textarea /> }))
vi.mock('@/features/knowledge/KnowledgeAttachments', () => ({ KnowledgeAttachments: () => null }))

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
const settings = (general: Record<string, unknown>) => ({ general }) as unknown as MegaBrainSettings
const render = () => act(async () => root.render(<NewCardDialog open onOpenChange={vi.fn()} />))

test('keeps the primary action visible while settings load', async () => {
  vi.mocked(fetchMegaBrainSettings).mockReturnValue(new Promise(() => {}))
  await render()
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Carregando…')
  expect(button).toBeDefined()
  expect(button?.disabled).toBe(true)
})

test('offers manual creation when an older backend omits the Jev flag', async () => {
  vi.mocked(fetchMegaBrainSettings).mockResolvedValue(settings({ layaEnabled: true }))
  await render()
  expect(host.textContent).toContain('Adicionar')
  expect(host.textContent).toContain('Nível do fluxo')
  expect(host.textContent).not.toContain('Analisar com Jev')
})

test('offers manual creation after settings fail to load', async () => {
  vi.mocked(fetchMegaBrainSettings).mockRejectedValue(new Error('offline'))
  await render()
  expect(host.textContent).toContain('Adicionar')
  expect(host.textContent).toContain('Nível do fluxo')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('escolhendo o fluxo manualmente')
})

test('offers Jev analysis when enabled', async () => {
  vi.mocked(fetchMegaBrainSettings).mockResolvedValue(settings({ jevEnabled: true }))
  await render()
  expect(host.textContent).toContain('Criar com Jev')
  expect(host.textContent).toContain('Criar (Difícil)')
  expect(host.textContent).not.toContain('Nível do fluxo')
})
