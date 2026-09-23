import { memo, useEffect, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CancelSquareIcon,
  Folder01Icon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  TriangleAlertIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { openFolder, openPrs, resetAutomaticStage } from '../model/card-commands'
import { isTauriDesktop } from '@/desktopBootstrap'
import { DevEnvPanel } from '@/features/dev-environments/DevEnvPanel'
import { Tip } from '@/Tip'
import type { AgentInfo } from '../../../../shared/domain/agents'
import type { Card, PrState } from '../../../../shared/domain/cards'
import { relativeTime } from '@/relativeTime'
import { attentionReason } from '@/boardFilters'
import { AgentBadge, activeAgents, agentName } from '@/CardAgentBadge'
import { FlowIndicator } from './FlowIndicator'
export { AgentBadge, activeAgents, agentName } from '@/CardAgentBadge'

export function StageResetButton({ agent, cardId }: { agent: AgentInfo; cardId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!agent.stage || agent.status !== 'rodando') return null
  const name = agentName(agent)

  const reset = async () => {
    setPending(true)
    setError(null)
    try {
      await resetAutomaticStage(cardId, agent.stage as string)
      setConfirming(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Tip label={`Interromper e limpar a etapa de ${name}`}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Interromper e limpar a etapa de ${name}`}
          className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={(event) => {
            event.stopPropagation()
            setConfirming(true)
          }}
        >
          <HugeiconsIcon icon={CancelSquareIcon} strokeWidth={2} />
        </Button>
      </Tip>
      <Dialog open={confirming} onOpenChange={(open) => !open && !pending && setConfirming(false)}>
        <DialogContent className="sm:max-w-md" onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Interromper a etapa de {name}?</DialogTitle>
            <DialogDescription>
              A execução será encerrada e o progresso, os logs e os artefatos acompanhados por esta etapa serão
              restaurados ao estado anterior. Código, commits e PRs já criados não serão apagados.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Voltar
            </Button>
            <Button variant="destructive" disabled={pending} onClick={reset}>
              {pending ? 'Interrompendo…' : 'Interromper e limpar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function PrChip({
  env,
  links,
  states,
  cardId,
}: {
  env: 'staging' | 'master'
  links: Record<string, string>
  states?: Record<string, PrState>
  cardId: string
}) {
  const entries = Object.entries(links)
  const urls = entries.map(([, url]) => url)
  const merged = urls.filter((url) => states?.[url] === 'merged').length
  const all = merged === urls.length
  const repoLabels = Object.entries(links)
    .map(([repo, url]) => (states?.[url] === 'merged' ? `${repo} ✓` : repo))
    .join(', ')
  const className = cn(
    'inline-flex items-center gap-1 rounded-sm px-1 py-px text-[10px] tabular-nums',
    all
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : 'bg-muted text-muted-foreground hover:text-foreground',
  )
  const label = (
    <>
      <HugeiconsIcon icon={all ? GitMergeIcon : GitPullRequestArrowIcon} strokeWidth={2} className="size-3" />
      {env === 'staging' ? 'stg' : 'mst'} {all ? '✓' : `${merged}/${urls.length}`}
    </>
  )
  if (urls.length === 1) {
    const [project, url] = entries[0]
    return (
      <Tip label={repoLabels}>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={className}
          onClick={(event) => {
            event.stopPropagation()
            if (!isTauriDesktop()) return
            event.preventDefault()
            void openPrs(cardId, env, project)
          }}
        >
          {label}
        </a>
      </Tip>
    )
  }
  return (
    <Tip label={`Abrir em uma janela: ${repoLabels}`}>
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation()
          openPrs(cardId, env)
        }}
      >
        {label}
      </button>
    </Tip>
  )
}

function AgentLine({ agent, cardId }: { agent: AgentInfo; cardId: string }) {
  const progress = agent.status === 'rodando' ? agent.progress : undefined
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <AgentBadge agent={agent} cardId={cardId} />
        <StageResetButton agent={agent} cardId={cardId} />
        {progress && (
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {Math.round((progress.done / progress.total) * 100)}%
          </span>
        )}
      </div>
      {progress && (
        <Progress
          value={progress.done}
          max={progress.total}
          className="mt-1.5"
          aria-label={`Progresso do agente ${agentName(agent)}`}
        />
      )}
    </div>
  )
}

function FolderName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [name])

  const label = (
    <span ref={ref} className="block min-w-0 max-w-full shrink truncate font-medium text-primary dark:text-chart-2">
      {name}
    </span>
  )
  return truncated ? <Tip label={name}>{label}</Tip> : label
}

export function CardBody({
  card,
  interactive = false,
  onOpen,
}: {
  card: Card
  interactive?: boolean
  onOpen?: () => void
}) {
  const agents = activeAgents(card)
  const attention = attentionReason(card)
  const [openingFolder, setOpeningFolder] = useState(false)

  const handleOpenFolder = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (openingFolder) return
    setOpeningFolder(true)
    await openFolder(card.id)
    setOpeningFolder(false)
  }

  return (
    <>
      <div
        className="mb-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground"
      >
        <FolderName name={card.id} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {attention && (
            <Tip label={attention}>
              <span
                role="img"
                aria-label={`Atenção: ${attention}`}
                className="inline-flex size-4 shrink-0 items-center justify-center text-amber-700 dark:text-amber-400"
              >
                <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} className="size-3.5" aria-hidden="true" />
              </span>
            </Tip>
          )}
          <FlowIndicator flow={card.flow} />
        </span>
      </div>
      {interactive ? (
        <button
          type="button"
          className="block w-full rounded-sm text-left leading-snug font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={(event) => {
            event.stopPropagation()
            onOpen?.()
          }}
        >
          {card.title}
        </button>
      ) : (
        <div className="leading-snug font-medium">{card.title}</div>
      )}
      {agents.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {agents.map((agent) => (
            <AgentLine key={agent.stage ?? 'autonomo'} agent={agent} cardId={card.id} />
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-1.5 border-t pt-2 text-[10px] text-muted-foreground">
        <Tip label={openingFolder ? 'Abrindo no editor...' : 'Abrir no editor configurado'}>
          <button
            type="button"
            aria-label={openingFolder ? 'Abrindo pasta no editor' : 'Abrir pasta no editor configurado'}
            disabled={openingFolder}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-70"
            onClick={handleOpenFolder}
          >
            {openingFolder ? (
              <Spinner className="size-3 shrink-0" />
            ) : (
              <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} className="size-3 shrink-0" />
            )}
          </button>
        </Tip>
        <span className="text-muted-foreground/50">·</span>
        <Tip label={card.updatedAt ? 'Última atualização' : 'Criado em'}>
          <span className="shrink-0 tabular-nums">{relativeTime(card.updatedAt ?? card.createdAt)}</span>
        </Tip>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {card.prs
            ? (['staging', 'master'] as const).map(
                (env) =>
                  card.prs?.[env] && (
                    <PrChip key={env} env={env} links={card.prs[env]} states={card.prStates} cardId={card.id} />
                  ),
              )
            : card.jiraStatus && <span className="uppercase">{card.jiraStatus}</span>}
        </span>
      </div>
      {(card.status === 'code-review' || (card.devEnv && card.devEnv.status !== 'parado')) && (
        <DevEnvPanel card={card} />
      )}
    </>
  )
}

interface Props {
  card: Card
  onOpen: (id: string, tab?: string) => void
}

export const CardView = memo(function CardView({ card, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id })
  const dragged = useRef(false)
  if (isDragging) dragged.current = true

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'kanban-card group relative touch-none cursor-grab rounded-md border border-transparent bg-card p-3 shadow-sm transition-[border-color,box-shadow] hover:border-primary/20 hover:shadow-md focus-within:border-primary/30 active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
      onPointerDown={(event) => {
        const interactiveTarget = (event.target as Element).closest(
          'button, a, input, textarea, select, [role="button"]',
        )
        if (interactiveTarget && interactiveTarget !== event.currentTarget) return
        dragged.current = false
        listeners?.onPointerDown?.(event)
      }}
      onClick={() => {
        if (!dragged.current) onOpen(card.id)
      }}
    >
      <CardBody card={card} interactive onOpen={() => onOpen(card.id)} />
    </div>
  )
})
