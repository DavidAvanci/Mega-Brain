import { useState } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { AiBrain01Icon, BlueprintIcon, ChatGptIcon, ClaudeIcon, RoboticIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Markdown } from '@/Markdown'
import { openTerminal } from './features/cards/model/card-commands'
import { Tip } from './Tip'
import { DefaultBranchDirtyDialog } from './features/cards/ui/DefaultBranchDirtyDialog'
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
  'run-task-checklist': { name: 'dev', icon: RoboticIcon },
  'stage-task': { name: 'staging', icon: RoboticIcon },
  'master-pr-task': { name: 'master', icon: RoboticIcon },
  'code-review': { name: 'Revisor', icon: RoboticIcon },
}

const AUTONOMOUS = { name: 'autônomo', icon: AiBrain01Icon }

function JevIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      role="img"
      aria-label="Jev"
      className="size-3.5 shrink-0"
    >
      <circle cx="4" cy="4" r="1.5" />
      <circle cx="12" cy="4" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
    </svg>
  )
}

function stageErrorSections(error: string) {
  const lines = error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const summary = lines[0]?.match(
    /^Itens:\s*(\d+)\/(\d+) concluídos,\s*(\d+) falhas,\s*(\d+) bloqueados(?:\s*·\s*(.*))?$/,
  )
  if (!summary) return null

  const metrics = (summary[5] ?? '').split(' · ').flatMap((part) => {
    const match = part.match(/^(Custo informado|Custo|Tempo de agente|Tempo de verificações):\s*(.+)$/)
    return match ? [{ label: match[1], value: match[2] }] : []
  })
  const environments: { repo: string; runtime: string; path: string }[] = []
  const failures: string[] = []
  const other: string[] = []
  let verification: string | undefined

  for (const line of lines.slice(1)) {
    const runtime = line.match(/^([^:\n]+): (Node [^(]+)\(([^)]+)\)$/)
    if (runtime) environments.push({ repo: runtime[1], runtime: runtime[2], path: runtime[3] })
    else if (line.startsWith('Verificações:')) verification = line.slice('Verificações:'.length).trim()
    else if (/^[A-Z][A-Z0-9_-]*:\s/.test(line)) failures.push(line)
    else other.push(line)
  }

  return {
    completed: `${summary[1]}/${summary[2]}`,
    failed: Number(summary[3]),
    blocked: Number(summary[4]),
    metrics,
    environments,
    failures,
    verification,
    other,
  }
}

function kindOf(agent: AgentInfo) {
  const kind = (agent.stage ? KINDS[agent.stage] : undefined) ?? AUTONOMOUS
  if (
    agent.execution === 'script' ||
    (agent.execution !== 'agent' && ['run-task-checklist', 'stage-task', 'master-pr-task'].includes(agent.stage ?? ''))
  )
    return { name: kind.name, icon: RoboticIcon }
  if (agent.provider === 'claude') return { name: agent.stage ? kind.name : agent.displayName ?? 'Claude', icon: ClaudeIcon }
  if (agent.provider === 'codex') return { name: agent.stage ? kind.name : agent.displayName ?? 'Codex', icon: ChatGptIcon }
  return agent.displayName ? { ...kind, name: agent.displayName } : kind
}

export function agentName(agent: AgentInfo): string {
  return kindOf(agent).name
}

export function activeAgents(card: Card): AgentInfo[] {
  return (card.agents ?? []).filter((agent) => agent.status !== 'concluido')
}

export function isStartingExecutors(card: Card): boolean {
  if (card.status !== 'desenvolvendo') return false
  const stageAgent = card.agents?.find((agent) => agent.stage === 'run-task-checklist')
  if (stageAgent?.status !== 'rodando') return false
  if (stageAgent.activity === 'Formatando arquivos...') return false
  const counts = card.taskCounts?.['TASK-CHECKLIST.json']
  if (counts && counts.done >= counts.total) return false
  const childAgents = activeAgents(card).filter(
    (agent) => agent.stage !== 'run-task-checklist' && ['rodando', 'aguardando'].includes(agent.status),
  )
  return !childAgents.some(
    (agent) => agent.taskId || agent.displayName === 'Verificador' || agent.displayName?.startsWith('Executor'),
  )
}

export function StartingExecutorsIndicator() {
  return <ScriptRunningIndicator text="Iniciando executores..." />
}

export function isFormattingCardFiles(card: Card): boolean {
  return card.status === 'desenvolvendo' && card.agents?.some(
    (agent) => agent.stage === 'run-task-checklist' && agent.status === 'rodando' && agent.activity === 'Formatando arquivos...',
  ) === true
}

export function ScriptRunningIndicator({ text }: { text: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-primary dark:text-chart-2">
      <HugeiconsIcon
        icon={RoboticIcon}
        strokeWidth={2}
        className="size-3.5 shrink-0"
        aria-label="Script em execução"
      />
      <span className="truncate">{text}</span>
    </span>
  )
}

export function AgentBadge({
  agent,
  cardId,
  iconOnly = false,
  muted = false,
  growText = false,
  interactive = true,
}: {
  agent: AgentInfo
  cardId: string
  iconOnly?: boolean
  muted?: boolean
  growText?: boolean
  interactive?: boolean
}) {
  const [showError, setShowError] = useState(false)
  const isStartingAgent = !agent.provider && agent.phase === 'Iniciando agente'
  const isJevRunning = agent.status === 'rodando' && agent.stage === 'task-planning' && agent.phase === 'Jev escolhendo modelo e esforço'
  const fallbackPhase = agent.taskId
    ? `Implementando ${agent.taskId}`
    : agent.displayName === 'Verificador'
      ? 'Verificando tasks'
      : agent.execution === 'agent' && !agent.stage
        ? 'Iniciando agente'
        : undefined
  const { label, className } = BADGES[agent.status]
  const { name, icon } = kindOf(agent)
  const error = agent.status === 'erro' ? agent.error : undefined
  const structuredError = error ? stageErrorSections(error) : null
  const stageText =
    agent.status === 'rodando' && (agent.phase || agent.activity || fallbackPhase)
      ? agent.phase || fallbackPhase
        ? `${agent.phase || fallbackPhase}...`
        : agent.activity
      : agent.status === 'erro' && error
        ? `erro · ${error.split('\n', 1)[0]}`
        : label
  const hasNarration =
    agent.execution !== 'script' &&
    Boolean(agent.activity) &&
    (agent.provider === 'claude' || agent.execution === 'agent')
  const text = agent.status === 'rodando' && hasNarration ? agent.activity : stageText
  const showInlineText =
    !iconOnly ||
    (agent.stage === 'task-planning' && agent.status === 'rodando') ||
    isStartingAgent ||
    ['rodando', 'aguardando'].includes(agent.status) ||
    agent.status === 'erro' ||
    Boolean(agent.phase) ||
    hasNarration ||
    agent.status === 'pausado'
  const inlineText = isStartingAgent
    ? 'Iniciando agente...'
    : !agent.taskId && agent.displayName && agent.displayName !== 'Verificador' && text
      ? `${agent.displayName} · ${text}`
      : text
  const tip = isStartingAgent
    ? 'Iniciando agente...'
    : iconOnly
      ? `${name}${interactive && agent.sessionId ? ' · Abrir no terminal' : ''}`
      : agent.status === 'erro'
        ? `Ver erro completo de ${name}`
        : [name, interactive && agent.sessionId ? 'Abrir no terminal' : ''].filter(Boolean).join(' · ')
  const tooltipLabel = hasNarration ? (
    <div className="max-h-[min(60vh,24rem)] w-[min(32rem,calc(100vw_-_2rem))] overflow-y-auto pr-1">
      <Markdown text={agent.activity ?? ''} />
      <div className="mt-2 border-t border-border/60 pt-1.5 text-[10px] text-muted-foreground">
        {name}
        {interactive && agent.sessionId ? ' · Abrir no terminal' : ''}
      </div>
    </div>
  ) : (
    tip
  )
  const Element = interactive ? 'button' : 'span'
  return (
    <>
      <Tip
        label={tooltipLabel}
        arrowClassName={hasNarration ? 'bg-popover fill-popover' : undefined}
        contentClassName={
          hasNarration
            ? 'w-[min(32rem,calc(100vw_-_1rem))] max-w-none items-start gap-0 bg-popover p-3 text-popover-foreground shadow-md'
            : undefined
        }
      >
        <Element
          type={interactive ? 'button' : undefined}
          aria-label={
            iconOnly
              ? isStartingAgent
                ? 'Iniciando agente...'
                : agent.status === 'pausado'
                  ? `Agente ${name} pausado`
                  : `Agente ${name} trabalhando`
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
          onClick={
            interactive
              ? (event) => {
                  event.stopPropagation()
                  if (agent.status === 'erro') setShowError(true)
                  else if (agent.sessionId) openTerminal(cardId)
                }
              : undefined
          }
        >
          {isStartingAgent ? (
            <Spinner className="size-3.5 shrink-0" aria-label="Iniciando agente..." />
          ) : isJevRunning ? (
            <JevIcon />
          ) : (
            <HugeiconsIcon
              icon={icon}
              strokeWidth={2}
              aria-label={
                icon === RoboticIcon
                  ? 'Script em execução'
                  : agent.provider === 'claude'
                    ? 'Claude'
                    : agent.provider === 'codex'
                      ? 'Codex'
                      : undefined
              }
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
        </Element>
      </Tip>
      {agent.status === 'erro' && (
        <Dialog open={showError} onOpenChange={setShowError}>
          <DialogContent
            className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle>Erro do agente {name}</DialogTitle>
              <DialogDescription>Card {cardId}</DialogDescription>
            </DialogHeader>
            {agent.defaultBranchDirty?.length ? (
              <DefaultBranchDirtyDialog key={`${cardId}-${agent.defaultBranchDirty.map((entry) => entry.repositoryId).join('-')}`} cardId={cardId} changes={agent.defaultBranchDirty} />
            ) : null}
            {structuredError ? (
              <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1 select-text">
                <section className="rounded-md border bg-muted/40 p-3">
                  <h3 className="text-xs font-semibold">Resumo da execução</h3>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { label: 'Itens concluídos', value: structuredError.completed, tone: 'text-foreground' },
                      { label: 'Falhas', value: String(structuredError.failed), tone: structuredError.failed ? 'text-destructive' : 'text-foreground' },
                      { label: 'Bloqueados', value: String(structuredError.blocked), tone: structuredError.blocked ? 'text-amber-700 dark:text-amber-400' : 'text-foreground' },
                      ...structuredError.metrics.map((metric) => ({ ...metric, tone: 'text-foreground' })),
                    ].map((metric) => (
                      <div key={metric.label} className="min-w-0 rounded-md bg-background/70 px-2.5 py-2">
                        <div className="text-[10px] text-muted-foreground">{metric.label}</div>
                        <div className={cn('mt-0.5 break-words text-xs font-medium', metric.tone)}>{metric.value}</div>
                      </div>
                    ))}
                  </div>
                </section>
                {structuredError.environments.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold">Ambientes Node</h3>
                    <div className="space-y-2">
                      {structuredError.environments.map((environment) => (
                        <div key={environment.repo} className="rounded-md border px-3 py-2">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                            <span className="font-medium">{environment.repo}</span>
                            <span className="text-muted-foreground">{environment.runtime}</span>
                          </div>
                          <code className="mt-1 block break-all text-[10px] text-muted-foreground">{environment.path}</code>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {structuredError.verification && (
                  <section className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                    <h3 className="text-xs font-semibold">Verificações</h3>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">{structuredError.verification}</p>
                  </section>
                )}
                {structuredError.failures.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold">Itens com erro</h3>
                    <ul className="space-y-1.5">
                      {structuredError.failures.map((failure, index) => (
                        <li key={`${index}-${failure}`} className="rounded-md border border-destructive/20 px-3 py-2 text-xs leading-relaxed">
                          {failure}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {structuredError.other.length > 0 && (
                  <section>
                    <h3 className="mb-1 text-xs font-semibold">Outros detalhes</h3>
                    <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                      {structuredError.other.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
                    </ul>
                  </section>
                )}
                <details className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium">Texto completo do erro</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t pt-2 font-mono text-[11px] leading-relaxed">{error}</pre>
                </details>
              </div>
            ) : (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-4 font-mono text-xs leading-relaxed select-text">
                {error ?? 'Nenhum detalhe do erro foi registrado.'}
              </pre>
            )}
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
