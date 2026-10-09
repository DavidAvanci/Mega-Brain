import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PauseIcon, PlayIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tip } from '@/Tip'
import type { AgentInfo } from '../../../../shared/domain/agents'
import { pauseCardAgents, resumeCardAgents } from '../model/card-commands'

export function CardAgentControl({ agent, cardId }: { agent?: AgentInfo; cardId: string }) {
  const busy = useRef(false)
  const [pending, setPending] = useState(false)
  const available = Boolean(
    agent?.stage && agent.resumable && ['rodando', 'aguardando', 'pausado'].includes(agent.status),
  )
  const [mounted, setMounted] = useState(available)
  const [lastAgent, setLastAgent] = useState(agent)
  useEffect(() => {
    if (agent) setLastAgent(agent)
  }, [agent])
  useEffect(() => {
    if (available) {
      setMounted(true)
      return
    }
    const timeout = window.setTimeout(() => setMounted(false), 150)
    return () => window.clearTimeout(timeout)
  }, [available])

  const displayAgent = agent ?? lastAgent
  const paused = displayAgent?.status === 'pausado'
  const label = paused ? 'Retomar agentes deste card' : 'Pausar agentes deste card'
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center">
      {mounted && displayAgent?.stage && (
        <Tip label={pending ? (paused ? 'Retomando agentes…' : 'Salvando pausa…') : label}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-state={available ? 'open' : 'closed'}
            aria-hidden={!available}
            tabIndex={available ? undefined : -1}
            className="size-5 shrink-0 p-0 text-muted-foreground hover:text-muted-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none"
            style={{ color: 'var(--muted-foreground)' }}
            aria-label={label}
            aria-busy={pending}
            disabled={!available || pending}
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
      )}
    </span>
  )
}
