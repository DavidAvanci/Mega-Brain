import { renderToStaticMarkup } from 'react-dom/server'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChatGptIcon, ClaudeIcon, RoboticIcon } from '@hugeicons/core-free-icons'
import { expect, test, vi } from 'vitest'
import { AgentBadge } from './CardAgentBadge'

vi.mock('@/Tip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }))

function iconPaths(markup: string): string[] {
  return [...markup.matchAll(/<path\b[^>]*>/g)].map(([path]) => path)
}

test.each([
  { provider: 'claude' as const, label: 'Claude', icon: ClaudeIcon },
  { provider: 'codex' as const, label: 'Codex', icon: ChatGptIcon },
])('agent badge uses the $label icon', ({ provider, label, icon }) => {
  const badge = renderToStaticMarkup(
    <AgentBadge cardId="card" agent={{ provider, status: 'rodando', phase: 'Chat' }} />,
  )
  const expected = renderToStaticMarkup(<HugeiconsIcon icon={icon} strokeWidth={2} />)
  expect(badge).toContain(`aria-label="${label}"`)
  expect(iconPaths(badge)).toEqual(iconPaths(expected))
})

test.each(['run-task-checklist', 'stage-task', 'master-pr-task'])(
  'uses a robot for the %s script even with provider metadata',
  (stage) => {
    const badge = renderToStaticMarkup(
      <AgentBadge
        cardId="card"
        agent={{
          stage,
          provider: 'claude',
          execution: 'script',
          status: 'rodando',
          phase: 'Executando script',
          activity: 'Texto antigo da IA',
        }}
      />,
    )
    expect(iconPaths(badge)).toEqual(
      iconPaths(renderToStaticMarkup(<HugeiconsIcon icon={RoboticIcon} strokeWidth={2} />)),
    )
    expect(badge).toContain('Executando script')
    expect(badge).not.toContain('Texto antigo da IA')
  },
)

test.each(['claude', 'codex'] as const)('Smart Diff shows %s narration instead of the generic phase', (provider) => {
  const badge = renderToStaticMarkup(
    <AgentBadge
      cardId="card"
      iconOnly
      interactive={false}
      agent={{
        stage: 'smart-diff-review',
        provider,
        execution: 'agent',
        status: 'rodando',
        phase: 'Rodando o agente de revisão',
        activity: 'Estou conferindo como a validação afeta a rota.',
      }}
    />,
  )
  expect(badge).toContain('Estou conferindo como a validação afeta a rota.')
  expect(badge).not.toContain('Rodando o agente de revisão')
  expect(badge).not.toContain('<button')
  expect(badge).toContain(`aria-label="${provider === 'claude' ? 'Claude' : 'Codex'}"`)
})
