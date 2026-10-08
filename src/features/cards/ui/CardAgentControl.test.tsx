// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { CardAgentControl } from './CardAgentControl'

const actions = vi.hoisted(() => ({ pauseCardAgents: vi.fn(), resumeCardAgents: vi.fn() }))
vi.mock('../model/card-commands', () => actions)
vi.mock('@/Tip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }))

test('pauses and resumes from an accessible card control without opening the card', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const open = vi.fn()
  let complete!: () => void
  actions.pauseCardAgents.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  try {
    await act(async () =>
      root.render(
        <div onClick={open}>
          <CardAgentControl
            cardId="CARD-1"
            agent={{ stage: 'run-task-checklist', status: 'rodando', resumable: true }}
          />
        </div>,
      ),
    )
    const button = host.querySelector<HTMLButtonElement>('button')!
    expect(button.getAttribute('aria-label')).toBe('Pausar agentes deste card')
    expect(button.className).toContain('size-10')
    await act(async () => button.click())
    expect(actions.pauseCardAgents).toHaveBeenCalledWith('CARD-1', 'run-task-checklist')
    expect(button.disabled).toBe(true)
    expect(open).not.toHaveBeenCalled()
    await act(async () => {
      complete()
      await Promise.resolve()
    })
    await act(async () =>
      root.render(
        <div onClick={open}>
          <CardAgentControl
            cardId="CARD-1"
            agent={{ stage: 'run-task-checklist', status: 'pausado', resumable: true }}
          />
        </div>,
      ),
    )
    const resume = host.querySelector<HTMLButtonElement>('button')!
    expect(resume.getAttribute('aria-label')).toBe('Retomar agentes deste card')
    await act(async () => resume.click())
    expect(actions.resumeCardAgents).toHaveBeenCalledWith('CARD-1', 'run-task-checklist')
    expect(open).not.toHaveBeenCalled()
    await act(async () =>
      root.render(<CardAgentControl cardId="CARD-1" agent={{ status: 'rodando', sessionControlId: 'external' }} />),
    )
    expect(host.querySelector('button')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.clearAllMocks()
  }
})
