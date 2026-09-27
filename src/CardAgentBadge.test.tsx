import { renderToStaticMarkup } from 'react-dom/server'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChatGptIcon, ClaudeIcon } from '@hugeicons/core-free-icons'
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
