import { useState } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  AiBrain01Icon,
  BlueprintIcon,
  ChatGptIcon,
  ClaudeIcon,
  CodeIcon,
  FlaskConicalIcon,
  GitPullRequestIcon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Markdown } from '@/Markdown'
import { openTerminal } from './features/cards/model/card-commands'
import { Tip } from './Tip'
import type { AgentInfo, AgentStatus } from '../shared/domain/agents'
import type { Card } from '../shared/domain/cards'

const BADGES: Record<AgentStatus, { label: string; className: string }> = {
  rodando: { label: 'rodando', className: 'text-primary dark:text-chart-2' },
  aguardando: { label: 'aguardando…', className: 'text-amber-600 dark:text-amber-400' },
  concluido: { label: 'concluído', className: 'text-emerald-600 dark:text-emerald-400' },
  erro: { label: 'erro', className: 'text-destructive' },
  pausado: { label: 'pausado', className: 'text-muted-foreground' },
  morto: { label: 'interrompido', className: 'text-muted-foreground' },
}

const KINDS: Record<string, { name: string; icon: IconSvgElement }> = {
  'task-planning': { name: 'plano', icon: BlueprintIcon },
  'run-task-checklist': { name: 'dev', icon: CodeIcon },
  'run-test-checklist': { name: 'testes', icon: FlaskConicalIcon },
  'stage-task': { name: 'staging', icon: GitPullRequestIcon },
  'master-pr-task': { name: 'master', icon: GitPullRequestIcon },
}

const AUTONOMOUS = { name: 'autônomo', icon: AiBrain01Icon }

function kindOf(agent: AgentInfo) {
  const kind = (agent.stage ? KINDS[agent.stage] : undefined) ?? AUTONOMOUS
  if (agent.provider === 'claude') return { name: agent.stage ? kind.name : 'Claude', icon: ClaudeIcon }
  if (agent.provider === 'codex') return { name: agent.stage ? kind.name : 'Codex', icon: ChatGptIcon }
  return kind
}

export function agentName(agent: AgentInfo): string {
  return kindOf(agent).name
}

export function activeAgents(card: Card): AgentInfo[] {
  return (card.agents ?? []).filter((agent) => agent.status !== 'concluido')
}

export function AgentBadge({
  agent,
  cardId,
  iconOnly = false,
  muted = false,
  growText = false,
}: {
  agent: AgentInfo
  cardId: string
  iconOnly?: boolean
  muted?: boolean
  growText?: boolean
}) {
  const [showError, setShowError] = useState(false)
  const isStartingAgent = !agent.provider && agent.phase === 'Iniciando agente'
  const { label, className } = BADGES[agent.status]
  const { name, icon } = kindOf(agent)
  const error = agent.status === 'erro' ? agent.error : undefined
  const stageText =
    agent.status === 'rodando' && (agent.phase || agent.activity)
      ? agent.phase
        ? `${agent.phase}…`
        : agent.activity
      : agent.status === 'erro' && error
        ? `erro · ${error.split('\n', 1)[0]}`
        : label
  const text = agent.status === 'rodando' && agent.provider === 'claude' && agent.activity ? agent.activity : stageText
  const showInlineText =
    !iconOnly ||
    (agent.stage === 'task-planning' && agent.status === 'rodando') ||
    isStartingAgent ||
    Boolean(agent.phase) ||
    (agent.provider === 'claude' && Boolean(agent.activity)) ||
    agent.status === 'pausado'
  const inlineText =
    isStartingAgent
      ? 'Iniciando agente...'
      : text
  const tip = isStartingAgent
    ? 'Iniciando agente...'
    : iconOnly
    ? `${name}${agent.sessionId ? ' · Abrir no terminal' : ''}`
    : agent.status === 'erro'
      ? `Ver erro completo de ${name}`
      : [name, agent.sessionId ? 'Abrir no terminal' : ''].filter(Boolean).join(' · ')
  const hasClaudeActivity = agent.provider === 'claude' && Boolean(agent.activity)
  const tooltipLabel = hasClaudeActivity ? (
    <div className="max-h-[min(60vh,24rem)] w-[min(32rem,calc(100vw_-_2rem))] overflow-y-auto pr-1">
      <Markdown text={agent.activity ?? ''} />
      <div className="mt-2 border-t border-border/60 pt-1.5 text-[10px] text-muted-foreground">
        {name}{agent.sessionId ? ' · Abrir no terminal' : ''}
      </div>
    </div>
  ) : tip
  return (
    <>
      <Tip
        label={tooltipLabel}
        arrowClassName={hasClaudeActivity ? 'bg-popover fill-popover' : undefined}
        contentClassName={
          hasClaudeActivity
            ? 'w-[min(32rem,calc(100vw_-_1rem))] max-w-none items-start gap-0 bg-popover p-3 text-popover-foreground shadow-md'
            : undefined
        }
      >
        <button
          type="button"
          aria-label={
            iconOnly
              ? isStartingAgent
                ? 'Iniciando agente...'
                : agent.status === 'pausado' ? `Agente ${name} pausado` : `Agente ${name} trabalhando`
              : agent.status === 'erro'
                ? `Ver erro completo do agente ${name}`
                : undefined
          }
          className={cn(
            'inline-flex min-w-0 max-w-full items-center gap-1 text-[11px]',
            agent.stage === 'task-planning' && 'justify-start text-left',
            growText && 'flex-1',
            className,
            muted && 'text-muted-foreground',
          )}
          onClick={(event) => {
            event.stopPropagation()
            if (agent.status === 'erro') setShowError(true)
            else if (agent.sessionId) openTerminal(cardId)
          }}
        >
          {isStartingAgent ? (
            <Spinner className="size-3.5 shrink-0" aria-label="Iniciando agente..." />
          ) : (
            <HugeiconsIcon
              icon={icon}
              strokeWidth={2}
              aria-label={agent.provider === 'claude' ? 'Claude' : agent.provider === 'codex' ? 'Codex' : undefined}
              className="size-3.5 shrink-0"
            />
          )}
          {showInlineText && (
            <span
              className={cn(
                'truncate text-left',
                agent.stage === 'task-planning' && 'min-w-0 text-left',
                growText && 'flex-1',
                agent.status === 'rodando' && !muted && 'agent-working-text-glow',
              )}
            >
              {inlineText}
            </span>
          )}
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
