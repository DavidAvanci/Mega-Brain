import { AgentBadge } from '@/CardAgentBadge'
import type { AgentInfo } from '../../../../shared/domain/agents'

export function SmartDiffIndicator({ cardId, activity }: { cardId: string; activity?: AgentInfo }) {
  return (
    <span role="status" aria-label="Smart Diff em execução" className="flex min-w-0 max-w-full">
      <AgentBadge
        cardId={cardId}
        agent={
          activity ?? {
            stage: 'smart-diff-review',
            execution: 'script',
            status: 'rodando',
            phase: 'Iniciando revisão Smart Diff',
          }
        }
        iconOnly
        growText
        interactive={false}
      />
    </span>
  )
}
