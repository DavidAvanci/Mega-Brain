// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DiffTab } from './DiffTab'
import { CardBody } from './CardView'
import { cardsState, setCardsState } from '../model/cards-state'
import { toCards } from '../model/card-mappers'

const mocks = vi.hoisted(() => ({ fetchDiff: vi.fn(), fetchStandardDiff: vi.fn(), startDiff: vi.fn() }))
vi.mock('../api/card-detail-api', () => mocks)
vi.mock('@/theme', () => ({ useTheme: () => 'light' }))
vi.mock('@/components/ui/button', () => ({ Button: 'button' }))
vi.mock('@/Tip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }))
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
  setCardsState({
    cards: toCards(
      [{ name: 'card-1', path: '/card-1', title: 'Card', description: '', createdAt: '', status: 'a-fazer' }],
      {},
    ),
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
  vi.useRealTimers()
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

test('shows the generated explanation and code snippets by default, with access to the diff', async () => {
  mocks.fetchDiff.mockResolvedValue({
    status: 'ready',
    started: true,
    result: {
      schemaVersion: 1,
      generatedAt: '',
      repositories: [
        {
          name: 'api',
          review: { schemaVersion: 2, sections: [], noise: [] },
          explanation:
            '# Novo comportamento\n\nAgora a instalação termina antes do reload.\n\n```ts\nawait registration.update()\n```',
        },
      ],
    },
  })
  await openDiff()
  expect(host.querySelector('[aria-label="Explicação de api"]')?.textContent).toContain('Novo comportamento')
  expect(host.querySelector('pre code')?.textContent).toContain('await registration.update()')
  expect(mocks.startDiff).not.toHaveBeenCalled()

  await clickButton('Diff')
  expect(host.querySelector('[aria-label="Explicação de api"]')).toBeNull()
  expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Dividido')).toBe(true)

  await clickButton('Explicação')
  expect(host.querySelector('pre code')?.textContent).toContain('await registration.update()')
})

test('keeps older reviews without Markdown in the diff view', async () => {
  mocks.fetchDiff.mockResolvedValue({
    status: 'ready',
    started: true,
    result: {
      schemaVersion: 1,
      generatedAt: '',
      repositories: [{ name: 'api', review: { schemaVersion: 2, sections: [], noise: [] } }],
    },
  })
  await openDiff()
  expect(host.querySelector('[aria-label="Visualização do Smart Diff"]')).toBeNull()
  expect([...host.querySelectorAll('button')].some((button) => button.textContent === 'Dividido')).toBe(true)
})

test.each(['claude', 'codex'] as const)(
  'shows %s narration with its icon and keeps completed steps',
  async (provider) => {
    mocks.fetchDiff.mockResolvedValue({
      status: 'running',
      started: true,
      steps: [
        'Identificando repositórios do card',
        'Rodando a ferramenta Smart Diff em api',
        'Rodando o agente de revisão',
      ],
      activity: {
        stage: 'smart-diff-review',
        execution: 'agent',
        status: 'rodando',
        provider,
        phase: 'Rodando o agente de revisão',
        activity: 'Vou explicar a mudança de contrato e seu impacto.',
      },
    })
    await openDiff()
    const steps = host.querySelector('[aria-label="Etapas da revisão Smart Diff"]')!
    expect(steps.textContent).toContain('Rodando a ferramenta Smart Diff em api')
    expect(steps.textContent).toContain('Vou explicar a mudança de contrato e seu impacto.')
    expect(steps.querySelector(`[aria-label="${provider === 'claude' ? 'Claude' : 'Codex'}"]`)).not.toBeNull()
    expect(steps.querySelector('button')).toBeNull()
  },
)

test('shows the current script step with the robot icon', async () => {
  mocks.fetchDiff.mockResolvedValue({
    status: 'running',
    started: true,
    steps: ['Rodando a ferramenta Smart Diff em api'],
    activity: {
      stage: 'smart-diff-review',
      execution: 'script',
      status: 'rodando',
      phase: 'Rodando a ferramenta Smart Diff em api',
    },
  })
  await openDiff()
  expect(host.querySelector('[aria-label="Script em execução"]')).not.toBeNull()
  expect(host.textContent).toContain('Rodando a ferramenta Smart Diff em api')
})

test('shares live script steps with the closed card and clears them when the review finishes', async () => {
  vi.useFakeTimers()
  const firstStep = 'Identificando repositórios do card'
  mocks.fetchDiff.mockResolvedValue({ status: 'running', started: true, steps: [firstStep] })
  await openDiff()
  expect(renderToStaticMarkup(<CardBody card={cardsState().cards[0]} />)).toContain(firstStep)

  const phase = 'Rodando a ferramenta Smart Diff em api'
  mocks.fetchDiff.mockResolvedValue({
    status: 'running',
    started: true,
    steps: [firstStep, phase],
    activity: { stage: 'smart-diff-review', execution: 'script', status: 'rodando', phase },
  })
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(host.querySelector('[aria-label="Smart Diff em execução"]')?.textContent).toBe(`${phase}…`)
  const cardMarkup = renderToStaticMarkup(<CardBody card={cardsState().cards[0]} />)
  expect(cardMarkup).toContain(`${phase}…`)
  expect(cardMarkup).toContain('aria-label="Script em execução"')

  mocks.fetchDiff.mockResolvedValue({
    status: 'ready',
    started: true,
    result: { schemaVersion: 1, generatedAt: '', repositories: [] },
  })
  await act(async () => vi.advanceTimersByTimeAsync(1500))
  expect(cardsState().cards[0].smartDiffRunning).toBe(false)
  expect(renderToStaticMarkup(<CardBody card={cardsState().cards[0]} />)).not.toContain('Smart Diff em execução')
})

test('shows the robot on the closed card as soon as generation starts, before the next poll returns', async () => {
  mocks.fetchDiff.mockResolvedValueOnce({ status: 'error', started: false })
  await openDiff()
  mocks.fetchDiff.mockReturnValueOnce(new Promise(() => {}))
  await clickButton('Gerar Smart Diff')
  expect(cardsState().cards[0].smartDiffRunning).toBe(true)
  expect(renderToStaticMarkup(<CardBody card={cardsState().cards[0]} />)).toContain('Iniciando revisão Smart Diff')
})
