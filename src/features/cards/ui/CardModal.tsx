import { CardAgentControl } from './CardAgentControl'
import { CardKnowledgeAttachments } from '@/features/knowledge/CardKnowledgeAttachments'
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CancelSquareIcon,
  ComputerTerminal01Icon,
  Copy01Icon,
  Delete02Icon,
  Folder01Icon,
  LinkSquare02Icon,
  MaximizeScreenIcon,
  MinimizeScreenIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { AppSelect } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import {
  clearLatestStage,
  deleteCard,
  moveCard,
  openFolder,
  openPrs,
  openTerminal,
  setCardFlow,
  stopCardAgent,
  updateCardDescription,
} from '../model/card-commands'
import { type WorktreeRepoInfo } from '../api/card-detail-api'
import { AgentBadge, activeAgents, agentName } from '@/CardAgentBadge'
import { PrChip, StageResetButton } from './CardView'
import { isTauriDesktop } from '@/desktopBootstrap'
import { Markdown } from '@/Markdown'
import { countTasks, type TaskCounts } from '@/markdownFormat'
import { relativeTime } from '@/relativeTime'
import { Tip } from '@/Tip'
import { Textarea } from '@/components/ui/textarea'
import { useCardDetail } from '../model/useCardDetail'
import type { AgentInfo, CardAgentUsageEntry } from '../../../../shared/domain/agents'
import {
  FLOW_DESCRIPTIONS,
  FLOW_LABELS,
  FLOW_LEVELS,
  STATUSES,
  STATUS_LABELS,
  type Card,
  type FlowLevel,
  type PrState,
} from '../../../../shared/domain/cards'

const ChatTab = lazy(() => import('@/features/chat/ChatTab').then((module) => ({ default: module.ChatTab })))
const DiffTab = lazy(() => import('./DiffTab').then((module) => ({ default: module.DiffTab })))

const FILE_TABS = [
  { label: 'Plano', file: 'PLAN.md', outline: true, checklist: false },
  { label: 'Tasks', file: 'TASK-CHECKLIST.md', outline: false, checklist: true },
  { label: 'Tests', file: 'TEST-CHECKLIST.md', outline: false, checklist: true },
]

const DEFAULT_TAB: Partial<Record<Card['status'], string>> = {
  'revisao-de-plano': 'PLAN.md',
  desenvolvendo: 'TASK-CHECKLIST.md',
  'auto-testing': 'TEST-CHECKLIST.md',
  'code-review': 'diff',
  staging: 'links',
  'aguardando-deploy': 'links',
}

const PR_ENVS = [
  { env: 'staging', label: 'Staging' },
  { env: 'master', label: 'Master' },
] as const

const PR_STATE: Record<PrState, { label: string; className: string }> = {
  open: { label: 'aberto', className: 'text-amber-600 dark:text-amber-400' },
  merged: { label: 'merged', className: 'text-emerald-600 dark:text-emerald-400' },
  closed: { label: 'fechado', className: 'text-muted-foreground' },
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <Tip label="Copiar id">
      <button
        type="button"
        className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary dark:hover:text-chart-2"
        onClick={() => navigator.clipboard.writeText(id).then(() => setCopied(true))}
      >
        {id}
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className={cn('size-3', copied ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-50')}
        />
      </button>
    </Tip>
  )
}

function StatusSelect({ card }: { card: Card }) {
  return (
    <Tip label="Mover de etapa">
      <AppSelect
        value={card.status}
        ariaLabel="Mover de etapa"
        compact
        onValueChange={(status) => moveCard(card.id, status)}
        className="h-6 w-auto rounded-md bg-muted/40 px-1.5 font-medium"
        options={STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
      />
    </Tip>
  )
}

function FlowSelect({ card }: { card: Card }) {
  return (
    <Tip label={`${FLOW_DESCRIPTIONS[card.flow]} A mudança vale para as próximas etapas.`}>
      <AppSelect
        ariaLabel="Nível do fluxo"
        value={card.flow}
        compact
        onValueChange={(flow) => setCardFlow(card.id, flow as FlowLevel)}
        className="h-6 w-auto rounded-md bg-muted/40 px-1.5 font-medium"
        options={FLOW_LEVELS.map((level) => ({ value: level, label: `Fluxo ${FLOW_LABELS[level]}` }))}
      />
    </Tip>
  )
}

function TabCounter({ counts }: { counts: TaskCounts }) {
  if (!counts.total) return null
  const complete = counts.done === counts.total
  return (
    <span className="inline-flex items-center gap-1 text-[10px] tabular-nums">
      <span
        className={cn(
          'rounded-sm px-1 py-px',
          complete
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            : 'bg-foreground/10 text-muted-foreground',
        )}
      >
        {counts.done}/{counts.total}
      </span>
      {counts.failed > 0 && (
        <span className="rounded-sm bg-destructive/10 px-1 py-px font-semibold text-destructive">{counts.failed}!</span>
      )}
      {counts.skipped > 0 && (
        <span className="rounded-sm bg-foreground/10 px-1 py-px font-semibold text-muted-foreground">
          {counts.skipped}-
        </span>
      )}
    </span>
  )
}

function Placeholder({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-xs text-muted-foreground">{children}</p>
}

function LoadingLines() {
  return (
    <div className="flex flex-col gap-2.5 py-1">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-11/12" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="mt-3 h-4 w-1/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

function formatAgentTime(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}min ${seconds % 60}s`
}

function usageEntryTitle(entry: CardAgentUsageEntry): string {
  const labels: Record<string, string> = {
    'task-planning': 'Planejamento',
    'run-task-checklist': 'Desenvolvimento',
    'run-test-checklist': 'Testes automáticos',
    'stage-task': 'Publicação em staging',
    'master-pr-task': 'Publicação em produção',
    chat: 'Chat',
  }
  const label = entry.label ? (labels[entry.label] ?? entry.label) : 'Execução sem categoria'
  const provider = entry.provider === 'claude' ? 'Claude' : entry.provider === 'codex' ? 'Codex' : undefined
  return [label, provider, entry.model].filter(Boolean).join(' · ')
}

function formatUsageDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Data desconhecida'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUsageCost(costUsd: number | undefined): string {
  if (costUsd === undefined) return 'Não informado'
  return `$${costUsd.toFixed(costUsd > 0 && costUsd < 0.01 ? 4 : 2).replace('.', ',')}`
}

function PrLinksList({ card }: { card: Card }) {
  return (
    <div className="flex flex-col gap-5 py-1">
      {PR_ENVS.map(({ env, label }) => {
        const entries = Object.entries(card.prs?.[env] ?? {})
        if (!entries.length) return null
        return (
          <section key={env}>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">PRs {label}</h3>
              {entries.length > 1 && (
                <Button variant="ghost" size="xs" className="ml-auto" onClick={() => openPrs(card.id, env)}>
                  <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} />
                  Abrir todos
                </Button>
              )}
            </div>
            <ul className="divide-y rounded-md border">
              {entries.map(([repo, url]) => {
                const state = card.prStates?.[url]
                const number = url.split('/').pop()
                return (
                  <li key={repo} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="w-40 shrink-0 truncate font-medium">{repo}</span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline dark:text-chart-2"
                      onClick={(event) => {
                        if (!isTauriDesktop()) return
                        event.preventDefault()
                        void openPrs(card.id, env, repo)
                      }}
                    >
                      #{number}
                      <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3 shrink-0 opacity-60" />
                    </a>
                    {state && (
                      <span className={cn('ml-auto shrink-0 text-[11px]', PR_STATE[state].className)}>
                        {PR_STATE[state].label}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function CommitLink({ hash, shortHash }: { hash: string; shortHash: string }) {
  return (
    <code title={hash} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
      {shortHash}
    </code>
  )
}

function ReposList({ repos }: { repos: WorktreeRepoInfo[] }) {
  if (!repos.length) return <Placeholder>Nenhuma worktree vinculada a esta task.</Placeholder>
  return (
    <div className="flex flex-col gap-3 py-1">
      {repos.map((repo) => (
        <section key={repo.name} className="rounded-lg border p-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{repo.name}</h3>
            {repo.dirty && (
              <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                alterada
              </span>
            )}
            <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px]">{repo.branch}</span>
          </div>
          {repo.error ? (
            <p className="mt-2 text-xs text-destructive">{repo.error}</p>
          ) : (
            <dl className="mt-3 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Criada de</dt>
              <dd className="min-w-0">
                {repo.base ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span>{repo.base.ref}</span>
                    <CommitLink hash={repo.base.hash} shortHash={repo.base.shortHash} />
                    {repo.base.inferred && (
                      <span
                        className="text-[10px] text-muted-foreground"
                        title="Worktree anterior ao registro de origem; base calculada pelo merge-base"
                      >
                        inferida
                      </span>
                    )}
                  </span>
                ) : (
                  'Base não identificada'
                )}
              </dd>
              <dt className="text-muted-foreground">Versão atual</dt>
              <dd className="min-w-0">
                <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
                  <CommitLink hash={repo.head.hash} shortHash={repo.head.shortHash} />
                  <span className="truncate" title={repo.head.subject}>
                    {repo.head.subject}
                  </span>
                </span>
              </dd>
              <dt className="text-muted-foreground">Repositório</dt>
              <dd className="truncate font-mono text-[11px]" title={repo.remote ?? repo.repository}>
                {repo.remote ?? repo.repository}
              </dd>
              <dt className="text-muted-foreground">Worktree</dt>
              <dd className="truncate font-mono text-[11px]" title={repo.path}>
                {repo.path}
              </dd>
            </dl>
          )}
        </section>
      ))}
    </div>
  )
}

function DeleteCardButton({ card, onDeleted }: { card: Card; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await deleteCard(card.id)
      onDeleted()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setDeleting(false)
    }
  }

  return (
    <>
      <Button variant="destructive" size="xs" className="ml-auto" onClick={() => setConfirming(true)}>
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        Excluir
      </Button>
      <Dialog open={confirming} onOpenChange={(open) => !open && !deleting && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir "{card.title}"?</DialogTitle>
            <DialogDescription>
              A pasta <code className="text-foreground">{card.folder}</code> e todos os arquivos dela e as worktrees
              vinculadas serão apagados do disco. Essa ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={confirmDelete}>
              {deleting ? 'Excluindo…' : 'Excluir definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const STAGE_LABELS: Record<string, string> = {
  'task-planning': 'Planejando',
  'run-task-checklist': 'Desenvolvendo',
  'run-test-checklist': 'Auto Testing',
  'stage-task': 'Staging',
  'master-pr-task': 'Aguardando deploy',
}

function ClearLatestStageButton({ card }: { card: Card }) {
  const stage = card.lastStage
  const label = stage ? STAGE_LABELS[stage] : undefined
  const [pending, setPending] = useState(false)
  if (!stage || !label) return null
  const running = card.agents?.some(
    (agent) => agent.stage === stage && ['rodando', 'aguardando', 'pausado'].includes(agent.status),
  )
  const clear = async () => {
    setPending(true)
    await clearLatestStage(card.id, stage)
    setPending(false)
  }
  return (
    <Button
      variant="outline"
      size="xs"
      title={running ? 'Interrompa o agente antes de limpar a etapa' : undefined}
      disabled={pending || running}
      onClick={clear}
    >
      <HugeiconsIcon icon={CancelSquareIcon} strokeWidth={2} />
      {pending ? 'Limpando…' : `Limpar ${label}`}
    </Button>
  )
}

function AgentSessionStopButton({
  agent,
  iconOnly = false,
  onPendingChange,
}: {
  agent: AgentInfo
  iconOnly?: boolean
  onPendingChange?: (pending: boolean) => void
}) {
  const [pending, setPending] = useState(false)
  if (!agent.sessionControlId || !['rodando', 'aguardando'].includes(agent.status)) return null
  const stop = async () => {
    setPending(true)
    onPendingChange?.(true)
    await stopCardAgent(agent.sessionControlId as string)
    setPending(false)
    onPendingChange?.(false)
  }
  return (
    <Tip label="Interromper agente">
      <Button
        variant="ghost"
        size={iconOnly ? 'icon-xs' : 'xs'}
        className={iconOnly ? 'size-5 shrink-0 p-0 text-muted-foreground hover:text-destructive' : undefined}
        aria-label={iconOnly ? 'Interromper agente' : undefined}
        disabled={pending}
        onClick={stop}
      >
        {pending ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={CancelSquareIcon} strokeWidth={2} />}
        {!iconOnly && (pending ? 'Interrompendo…' : 'Interromper')}
      </Button>
    </Tip>
  )
}

function AgentStatusRow({ agent, cardId }: { agent: AgentInfo; cardId: string }) {
  const [stopping, setStopping] = useState(false)
  const progress = agent.status === 'rodando' && agent.stage !== 'task-planning' ? agent.progress : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <AgentBadge agent={agent} cardId={cardId} muted={stopping} />
        <CardAgentControl agent={agent} cardId={cardId} />
        {agent.stage ? (
          <StageResetButton agent={agent} cardId={cardId} iconOnly onPendingChange={setStopping} />
        ) : (
          <AgentSessionStopButton agent={agent} iconOnly onPendingChange={setStopping} />
        )}
        {agent.activity && agent.stage !== 'task-planning' && (
          <span className="min-w-0 truncate">{agent.activity}</span>
        )}
        {progress && (
          <span className="ml-auto shrink-0 tabular-nums">
            {progress.done}/{progress.total}
          </span>
        )}
      </div>
      {agent.status === 'pausado' && (
        <p role="status" className="text-xs text-muted-foreground">
          Progresso salvo. Você pode fechar o app e retomar este card depois.
        </p>
      )}
      {progress && (
        <Progress value={progress.done} max={progress.total} aria-label={`Progresso do agente ${agentName(agent)}`} />
      )}
    </div>
  )
}

function ActionBar({ card, onDeleted }: { card: Card; onDeleted: () => void }) {
  const [openingFolder, setOpeningFolder] = useState(false)

  const handleOpenFolder = async () => {
    if (openingFolder) return
    setOpeningFolder(true)
    await openFolder(card.id)
    setOpeningFolder(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tip label={openingFolder ? 'Abrindo no editor...' : card.folder}>
        <Button variant="outline" size="xs" disabled={openingFolder} onClick={handleOpenFolder}>
          {openingFolder ? <Spinner className="size-3.5" /> : <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} />}
          {openingFolder ? 'Abrindo...' : 'Editor'}
        </Button>
      </Tip>
      {card.agents?.some((agent) => agent.sessionId) && (
        <Button variant="outline" size="xs" onClick={() => openTerminal(card.id)}>
          <HugeiconsIcon icon={ComputerTerminal01Icon} strokeWidth={2} />
          Terminal
        </Button>
      )}
      {card.prs &&
        PR_ENVS.map(
          ({ env }) =>
            card.prs?.[env] && (
              <PrChip key={env} env={env} links={card.prs[env]} states={card.prStates} cardId={card.id} />
            ),
        )}
      <ClearLatestStageButton card={card} />
      <DeleteCardButton card={card} onDeleted={onDeleted} />
    </div>
  )
}

export function CardModal({
  card,
  initialTab,
  onClose,
  expanded,
  onExpandedChange,
  container,
}: {
  card: Card
  initialTab?: string
  onClose: () => void
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  container: HTMLElement
}) {
  const { files, repos, usage, usageBreakdown, error } = useCardDetail(card.id)
  const agents = activeAgents(card)
  const [activeTab, setActiveTab] = useState(
    initialTab && initialTab !== 'chat' ? initialTab : (DEFAULT_TAB[card.status] ?? 'description'),
  )
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState(card.description)
  const [descriptionText, setDescriptionText] = useState(card.description)
  const [savingDescription, setSavingDescription] = useState(false)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [chatWidth, setChatWidth] = useState(360)
  const resizingDivider = useRef(false)

  const resizeChat = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizingDivider.current) return
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    const width = bounds.right - event.clientX
    setChatWidth(Math.max(260, Math.min(width, bounds.width - 400)))
  }

  const saveDescription = async () => {
    setSavingDescription(true)
    setDescriptionError(null)
    try {
      await updateCardDescription(card.id, descriptionDraft)
      setDescriptionText(descriptionDraft)
      setEditingDescription(false)
    } catch (cause) {
      setDescriptionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSavingDescription(false)
    }
  }

  // Keep the portal mounted in the workspace so changing layouts preserves chat and editing state.
  return (
    <Dialog
      open
      modal={!expanded}
      disablePointerDismissal={expanded}
      onOpenChange={(open, eventDetails) => {
        if (open) return
        if (expanded && eventDetails.reason === 'escape-key') {
          eventDetails.cancel()
          onExpandedChange(false)
          return
        }
        onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        container={container}
        portalClassName={expanded ? 'h-full min-h-0' : undefined}
        overlayClassName={expanded ? 'hidden' : undefined}
        role={expanded ? 'main' : 'dialog'}
        className={cn(
          'flex h-[92dvh] max-h-[960px] w-[calc(100%-2rem)] max-w-[1280px] flex-col gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-[1280px]',
          expanded && 'relative top-auto left-auto z-auto h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 rounded-none bg-background shadow-none ring-0 sm:max-w-none data-open:animate-none',
        )}
      >
        <div className={cn(
          'flex shrink-0 items-center gap-1',
          expanded ? 'border-b px-3 py-2' : 'absolute top-2 right-2 z-10',
        )}>
          <DialogClose
            render={<Button variant="ghost" className={cn('mr-auto h-10', !expanded && 'hidden')} />}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            Voltar
          </DialogClose>
          <Tip label={expanded ? 'Voltar ao modal (Esc)' : 'Abrir como página'}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={expanded ? 'Voltar ao modal' : 'Abrir como página'}
              aria-pressed={expanded}
              onClick={() => onExpandedChange(!expanded)}
            >
              <HugeiconsIcon icon={expanded ? MinimizeScreenIcon : MaximizeScreenIcon} strokeWidth={2} />
            </Button>
          </Tip>
          <DialogClose
            render={<Button variant="ghost" size="icon" className={cn('size-10', expanded && 'hidden')} aria-label="Fechar card" title="Fechar card" />}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          </DialogClose>
        </div>
        <div
          className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(260px,2fr)] lg:grid-cols-[minmax(0,1fr)_8px_var(--chat-width)] lg:grid-rows-1"
          style={{ '--chat-width': `${chatWidth}px` } as CSSProperties}
        >
          <div className="flex min-h-0 min-w-0 flex-col">
            <DialogHeader className={cn('gap-2.5 border-b px-5 pt-4 pb-3', !expanded && 'pr-24 lg:pr-12')}>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                <CopyId id={card.id} />
                <StatusSelect card={card} />
                <FlowSelect card={card} />
                {card.jiraStatus && <span className="uppercase">Jira: {card.jiraStatus}</span>}
                <span className="tabular-nums">criado {relativeTime(card.createdAt)}</span>
              </div>
              <DialogTitle className="text-lg leading-snug">{card.title}</DialogTitle>
              {usage && (
                <details className="group w-full text-xs">
                  <summary
                    className="flex cursor-pointer list-none items-center gap-1.5 whitespace-nowrap text-muted-foreground select-none [&::-webkit-details-marker]:hidden"
                    aria-label="Uso acumulado dos agentes"
                  >
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      className="size-3 shrink-0 transition-transform group-open:rotate-90"
                    />
                    <span>Gastos dos agentes:</span>
                    <strong className="font-medium tabular-nums text-foreground">
                      {formatAgentTime(usage.durationMs)} •{' '}
                      {usage.runs > 0 && usage.unpricedRuns === usage.runs
                        ? 'indisponível'
                        : `$${usage.costUsd.toFixed(usage.costUsd > 0 && usage.costUsd < 0.01 ? 4 : 2)}${usage.unpricedRuns ? ' (parcial)' : ''}`}
                    </strong>
                    {usage.unpricedRuns > 0 && (
                      <span title={`${usage.unpricedRuns} execução(ões) sem custo informado pela CLI`}>
                        <Spinner className="size-3" aria-label="Custo parcial dos agentes" />
                      </span>
                    )}
                  </summary>
                  {usageBreakdown.length > 0 && (
                    <div className="mt-1.5 rounded-md border bg-muted/20 px-2 py-1.5">
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Valores em USD reportados pelo provedor; custos ausentes não são estimados.
                      </p>
                      <ol className="mt-1 max-h-36 divide-y overflow-y-auto border-t">
                        {usageBreakdown.map((entry) => (
                          <li key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5">
                            <span className="truncate font-medium text-foreground" title={usageEntryTitle(entry)}>
                              {usageEntryTitle(entry)}
                            </span>
                            <strong className="text-right font-medium tabular-nums text-foreground">
                              {entry.costUsd === undefined && !entry.finishedAt
                                ? 'Em andamento'
                                : formatUsageCost(entry.costUsd)}
                            </strong>
                            <span className="col-span-2 text-[11px] text-muted-foreground">
                              {formatUsageDate(entry.startedAt)} · {formatAgentTime(entry.durationMs)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </details>
              )}
              {agents.map((agent, index) => (
                <AgentStatusRow key={`${agent.stage ?? 'autonomo'}-${index}`} agent={agent} cardId={card.id} />
              ))}
              <ActionBar card={card} onDeleted={onClose} />
              {error && <p className="text-xs text-destructive">{error}</p>}
            </DialogHeader>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 gap-0">
              <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b px-3">
                <TabsTrigger value="description" className="flex-none px-2.5">
                  Descrição
                </TabsTrigger>
                {FILE_TABS.map((tab) => {
                  const content = files?.[tab.file]
                  return (
                    <TabsTrigger
                      key={tab.file}
                      value={tab.file}
                      disabled={files !== null && !content}
                      className="flex-none px-2.5"
                    >
                      {tab.label}
                      {tab.checklist && content && <TabCounter counts={countTasks(content)} />}
                    </TabsTrigger>
                  )
                })}
                <TabsTrigger value="diff" className="flex-none px-2.5">
                  Diff
                </TabsTrigger>
                <TabsTrigger value="repos" className="flex-none px-2.5">
                  Repos{repos?.length ? ` (${repos.length})` : ''}
                </TabsTrigger>
                {card.prs && (
                  <TabsTrigger value="links" className="flex-none px-2.5">
                    Links
                  </TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="description" className="overflow-y-auto px-5 py-4">
                <div className="mb-3 flex justify-end">
                  {editingDescription ? (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" disabled={savingDescription} onClick={() => {
                        setDescriptionDraft(card.description)
                        setDescriptionError(null)
                        setEditingDescription(false)
                      }}>Cancelar</Button>
                      <Button size="sm" disabled={savingDescription} onClick={() => void saveDescription()}>
                        {savingDescription ? 'Salvando…' : 'Salvar descrição'}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => {
                      setDescriptionDraft(card.description)
                      setEditingDescription(true)
                    }}>Editar descrição</Button>
                  )}
                </div>
                {descriptionError && <p className="mb-2 text-xs text-destructive" role="alert">{descriptionError}</p>}
                {editingDescription ? (
                  <Textarea
                    aria-label="Descrição do card"
                    value={descriptionDraft}
                    maxLength={12000}
                    className="min-h-48 resize-y"
                    onChange={(event) => setDescriptionDraft(event.target.value)}
                  />
                ) : descriptionText ? <Markdown text={descriptionText} /> : <Placeholder>Sem descrição.</Placeholder>}
                <CardKnowledgeAttachments card={card} />
              </TabsContent>
              {FILE_TABS.map((tab) => {
                const content = files?.[tab.file]
                return (
                  <TabsContent key={tab.file} value={tab.file} className="overflow-y-auto px-5 py-4">
                    {content ? (
                      <Markdown text={content} outline={tab.outline} />
                    ) : files ? (
                      <Placeholder>Sem {tab.file} na pasta.</Placeholder>
                    ) : (
                      <LoadingLines />
                    )}
                  </TabsContent>
                )
              })}
              <TabsContent value="diff" className="min-h-0 overflow-hidden">
                <Suspense fallback={<LoadingLines />}>
                  <DiffTab cardId={card.id} />
                </Suspense>
              </TabsContent>
              <TabsContent value="repos" className="overflow-y-auto px-5 py-4">
                {repos ? <ReposList repos={repos} /> : <LoadingLines />}
              </TabsContent>
              {card.prs && (
                <TabsContent value="links" className="overflow-y-auto px-5 py-4">
                  <PrLinksList card={card} />
                </TabsContent>
              )}
            </Tabs>
          </div>
          <div
            role="separator"
            aria-label="Redimensionar painel do chat"
            aria-orientation="vertical"
            aria-valuemin={260}
            aria-valuemax={780}
            aria-valuenow={chatWidth}
            tabIndex={0}
            className="group hidden cursor-col-resize touch-none items-center justify-center lg:flex"
            onPointerDown={(event) => {
              resizingDivider.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={resizeChat}
            onPointerUp={(event) => {
              resizingDivider.current = false
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => { resizingDivider.current = false }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setChatWidth((width) => Math.min(width + 24, 780))
              if (event.key === 'ArrowRight') setChatWidth((width) => Math.max(width - 24, 260))
            }}
          >
            <span className="h-full w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
          </div>
          <aside
            className="flex min-h-0 min-w-0 flex-col border-t bg-muted/10 lg:border-t-0"
            aria-label="Chat do card"
          >
            <div className={cn('shrink-0 border-b px-5 py-3', !expanded && 'lg:pr-24')}>
              <h2 className="text-sm font-semibold">Chat e execuções</h2>
              <p className="text-[11px] text-muted-foreground">Acompanhe a task e envie orientações ao agente.</p>
            </div>
            <div className="min-h-0 flex-1">
              <Suspense
                fallback={
                  <div className="px-5 py-4">
                    <LoadingLines />
                  </div>
                }
              >
                <ChatTab cardId={card.id} />
              </Suspense>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}
