import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { CardBody } from './CardView'
import { toCards, type WorkspaceFolder } from '../model/card-mappers'
import type { AgentInfo } from '../../../../shared/domain/agents'

vi.mock('@/Tip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/theme', () => ({ useTheme: () => 'light' }))

function card(activity?: AgentInfo, running = true) {
  return toCards(
    [
      {
        name: 'CARD-1',
        path: '/card',
        title: 'Alterar contrato',
        description: '',
        createdAt: '',
        status: 'a-fazer',
        smartDiffRunning: running,
        smartDiffActivity: activity,
      } satisfies WorkspaceFolder,
    ],
    {},
  )[0]
}

test.each([
  'Identificando repositórios do card',
  'Rodando a ferramenta Smart Diff em api',
  'Validando e salvando a revisão',
])('the closed card displays the current script step: %s', (phase) => {
  const markup = renderToStaticMarkup(
    <CardBody card={card({ stage: 'smart-diff-review', execution: 'script', status: 'rodando', phase })} />,
  )
  expect(markup).toContain(phase)
  expect(markup).toContain('aria-label="Script em execução"')
  expect(markup).toContain('aria-label="Smart Diff em execução"')
})

test.each(['claude', 'codex'] as const)('the closed card displays the %s informative message', (provider) => {
  const markup = renderToStaticMarkup(
    <CardBody
      card={card({
        stage: 'smart-diff-review',
        execution: 'agent',
        status: 'rodando',
        provider,
        phase: 'Rodando o agente de revisão',
        activity: 'Vou explicar a validação e os consumidores.',
      })}
    />,
  )
  expect(markup).toContain('Vou explicar a validação e os consumidores.')
  expect(markup).toContain(`aria-label="${provider === 'claude' ? 'Claude' : 'Codex'}"`)
  expect(markup).not.toContain('Rodando o agente de revisão')
})

test('the closed card hides completed Smart Diff activity', () => {
  const markup = renderToStaticMarkup(<CardBody card={card(undefined, false)} />)
  expect(markup).not.toContain('Smart Diff em execução')
})
