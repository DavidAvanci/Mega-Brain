import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ComputerTerminal01Icon,
  Copy01Icon,
  Delete02Icon,
  Folder01Icon,
  LinkSquare02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
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
import { deleteCard, moveCard, openFolder, openPrs, openTerminal, setCardFlow } from '../model/card-commands'
import { type WorktreeRepoInfo } from '../api/card-detail-api'
import { AgentBadge, activeAgents, agentName } from '@/CardAgentBadge'
import { PrChip, StageResetButton } from './CardView'
import { isTauriDesktop } from '@/desktopBootstrap'
import { Markdown } from '@/Markdown'
import { countTasks, type TaskCounts } from '@/markdownFormat'
import { relativeTime } from '@/relativeTime'
import { Tip } from '@/Tip'
import { useCardDetail } from '../model/useCardDetail'
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
      <DeleteCardButton card={card} onDeleted={onDeleted} />
    </div>
  )
}

export function CardModal({ card, initialTab, onClose }: { card: Card; initialTab?: string; onClose: () => void }) {
  const { files, repos, error } = useCardDetail(card.id)
  const agents = activeAgents(card)
  const [activeTab, setActiveTab] = useState(
    initialTab && initialTab !== 'chat' ? initialTab : (DEFAULT_TAB[card.status] ?? 'description'),
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92dvh] max-h-[880px] w-[calc(100%-2rem)] max-w-[1180px] flex-col gap-0 overflow-hidden p-0 shadow-2xl sm:h-[88dvh] sm:max-w-[1180px]">
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(260px,2fr)] lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1">
          <div className="flex min-h-0 min-w-0 flex-col">
            <DialogHeader className="gap-2.5 border-b px-5 pt-4 pb-3 pr-12">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                <CopyId id={card.id} />
                <StatusSelect card={card} />
                <FlowSelect card={card} />
                {card.jiraStatus && <span className="uppercase">Jira: {card.jiraStatus}</span>}
                <span className="tabular-nums">criado {relativeTime(card.createdAt)}</span>
              </div>
              <DialogTitle className="text-lg leading-snug">{card.title}</DialogTitle>
              {agents.map((agent) => {
                const progress = agent.status === 'rodando' ? agent.progress : undefined
                return (
                  <div key={agent.stage ?? 'autonomo'} className="flex flex-col gap-1.5">
                    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <AgentBadge agent={agent} cardId={card.id} />
                      <StageResetButton agent={agent} cardId={card.id} />
                      {agent.activity && <span className="min-w-0 truncate">{agent.activity}</span>}
                      {progress && (
                        <span className="ml-auto shrink-0 tabular-nums">
                          {progress.done}/{progress.total}
                        </span>
                      )}
                    </div>
                    {progress && (
                      <Progress
                        value={progress.done}
                        max={progress.total}
                        aria-label={`Progresso do agente ${agentName(agent)}`}
                      />
                    )}
                  </div>
                )
              })}
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
                {card.description ? <Markdown text={card.description} /> : <Placeholder>Sem descrição.</Placeholder>}
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
          <aside
            className="flex min-h-0 min-w-0 flex-col border-t bg-muted/10 lg:border-t-0 lg:border-l"
            aria-label="Chat do card"
          >
            <div className="shrink-0 border-b px-5 py-3">
              <h2 className="text-sm font-semibold">Chat</h2>
              <p className="text-[11px] text-muted-foreground">Converse com o agente desta task.</p>
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
