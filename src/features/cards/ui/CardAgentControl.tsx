import { useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PauseIcon, PlayIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tip } from '@/Tip'
import type { AgentInfo } from '../../../../shared/domain/agents'
import { pauseCardAgents, resumeCardAgents } from '../model/card-commands'

export function CardAgentControl({ agent, cardId }: { agent: AgentInfo; cardId: string }) {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  if (!agent.stage || !agent.resumable || !['rodando', 'aguardando', 'pausado'].includes(agent.status)) return null
  const paused = agent.status === 'pausado'
  const label = paused ? 'Retomar agentes deste card' : 'Pausar agentes deste card'
  return (
    <Tip label={pending ? (paused ? 'Retomando agentes…' : 'Salvando pausa…') : label}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-10 shrink-0 transition-[color,background-color,opacity] motion-reduce:transition-none text-muted-foreground hover:text-muted-foreground"
        style={{ color: 'var(--muted-foreground)' }}
        aria-label={label}
        aria-busy={pending}
        disabled={pending}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={async (event) => {
          event.stopPropagation()
          if (busy.current || !agent.stage) return
          busy.current = true
          setPending(true)
          try {
            await (paused ? resumeCardAgents : pauseCardAgents)(cardId, agent.stage)
          } finally {
            busy.current = false
            setPending(false)
          }
        }}
      >
        {pending ? (
          <Spinner className="size-4" aria-hidden="true" />
        ) : (
          <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} strokeWidth={2} className="size-4" aria-hidden="true" />
        )}
      </Button>
    </Tip>
  )
}
