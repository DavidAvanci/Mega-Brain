// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { AgentStatusRow } from './CardModal'

vi.mock('@/Tip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/theme', () => ({ useTheme: () => 'light' }))

test.each(['claude', 'codex'] as const)(
  'the modal shows %s informative text only once alongside the stop control',
  (provider) => {
    const narration = 'Vou explicar a mudança de contrato e os tradeoffs.'
    const markup = renderToStaticMarkup(
      <AgentStatusRow
        cardId="CARD-1"
        agent={{ execution: 'agent', provider, status: 'rodando', sessionControlId: 'review', activity: narration }}
      />,
    )
    expect(markup.split(narration)).toHaveLength(2)
    expect(markup).toContain(`aria-label="${provider === 'claude' ? 'Claude' : 'Codex'}"`)
    expect(markup).toContain('Interromper')
  },
)
