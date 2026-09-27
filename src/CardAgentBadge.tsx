import { useState } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  AiBrain01Icon,
  BlueprintIcon,
  CodeIcon,
  FlaskConicalIcon,
  GitPullRequestIcon,
  ServerIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { openTerminal } from './features/cards/model/card-commands'
import { Tip } from './Tip'
import type { AgentInfo, AgentStatus } from '../shared/domain/agents'
import type { Card } from '../shared/domain/cards'

const BADGES: Record<AgentStatus, { label: string; className: string }> = {
  rodando: { label: 'rodando', className: 'text-primary dark:text-chart-2' },
  aguardando: { label: 'aguardando…', className: 'text-amber-600 dark:text-amber-400' },
  concluido: { label: 'concluído', className: 'text-emerald-600 dark:text-emerald-400' },
  erro: { label: 'erro', className: 'text-destructive' },
  morto: { label: 'interrompido', className: 'text-muted-foreground' },
}

const KINDS: Record<string, { name: string; icon: IconSvgElement }> = {
  'task-planning': { name: 'plano', icon: BlueprintIcon },
  'run-task-checklist': { name: 'dev', icon: CodeIcon },
  'run-test-checklist': { name: 'testes', icon: FlaskConicalIcon },
  'stage-task': { name: 'staging', icon: ServerIcon },
  'master-pr-task': { name: 'master', icon: GitPullRequestIcon },
}

const AUTONOMOUS = { name: 'autônomo', icon: AiBrain01Icon }

function kindOf(agent: AgentInfo) {
  return (agent.stage ? KINDS[agent.stage] : undefined) ?? AUTONOMOUS
}

export function agentName(agent: AgentInfo): string {
  return kindOf(agent).name
}

export function activeAgents(card: Card): AgentInfo[] {
  return (card.agents ?? []).filter((agent) => agent.status !== 'concluido')
}

export function AgentBadge({ agent, cardId }: { agent: AgentInfo; cardId: string }) {
  const [showError, setShowError] = useState(false)
  const { label, className } = BADGES[agent.status]
  const { name, icon } = kindOf(agent)
  const error = agent.status === 'erro' ? agent.error : undefined
  const text =
    agent.status === 'rodando' && agent.phase
      ? `${agent.phase}…`
      : agent.status === 'erro' && error
        ? `erro · ${error.split('\n', 1)[0]}`
        : label
  const tip =
    agent.status === 'erro'
      ? `Ver erro completo de ${name}`
      : [name, agent.sessionId ? 'Abrir no terminal' : ''].filter(Boolean).join(' · ')
  return (
    <>
      <Tip label={tip}>
        <button
          type="button"
          aria-label={agent.status === 'erro' ? `Ver erro completo do agente ${name}` : undefined}
          className={cn('inline-flex min-w-0 max-w-full items-center gap-1 text-[11px]', className)}
          onClick={(event) => {
            event.stopPropagation()
            if (agent.status === 'erro') setShowError(true)
            else if (agent.sessionId) openTerminal(cardId)
          }}
        >
          <HugeiconsIcon
            icon={icon}
            strokeWidth={2}
            className={cn('size-3.5 shrink-0', agent.status === 'rodando' && 'animate-pulse')}
          />
          <span className="truncate">{text}</span>
        </button>
      </Tip>
      {agent.status === 'erro' && (
        <Dialog open={showError} onOpenChange={setShowError}>
          <DialogContent className="w-[calc(100%-2rem)] max-w-2xl sm:max-w-2xl" onClick={(event) => event.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Erro do agente {name}</DialogTitle>
              <DialogDescription>Card {cardId}</DialogDescription>
            </DialogHeader>
            <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-4 font-mono text-xs leading-relaxed select-text">
              {error ?? 'Nenhum detalhe do erro foi registrado.'}
            </pre>
            {agent.sessionId && (
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => openTerminal(cardId)}>
                  Abrir terminal
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
