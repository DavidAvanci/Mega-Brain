import { useMemo, useState } from 'react'
import {
  AiBrain01Icon,
  ChatGptIcon,
  ClaudeIcon,
  Clock01Icon,
  Folder01Icon,
  RefreshIcon,
  SparklesIcon,
  StopIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { AgentSession, AgentStatus } from '../../../shared/domain/agents'
import type { Card } from '../../../shared/domain/cards'
import { isAgentSessionActive, refreshAgentSessions, stopAgentSession, useAgentSessions } from './model/agents-state'

const STATUS_META: Record<AgentStatus, { label: string; dot: string }> = {
  rodando: { label: 'Rodando', dot: 'bg-emerald-500' },
  aguardando: { label: 'Aguardando', dot: 'bg-amber-500' },
  concluido: { label: 'Concluída', dot: 'bg-muted-foreground/50' },
  erro: { label: 'Erro', dot: 'bg-destructive' },
  morto: { label: 'Interrompida', dot: 'bg-muted-foreground' },
}
const PROVIDER_META = {
  claude: { icon: ClaudeIcon, label: 'Claude', className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  codex: { icon: ChatGptIcon, label: 'Codex', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
} as const
const DATE_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function isActive(session: AgentSession): boolean {
  return isAgentSessionActive(session)
}

function elapsed(startedAt: string): string {
  const totalMinutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000))
  if (totalMinutes < 1) return 'há menos de 1 min'
  if (totalMinutes < 60) return `há ${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.floor(hours / 24)}d`
}

function StopAgentButton({ session }: { session: AgentSession }) {
  const [confirming, setConfirming] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = async () => {
    setStopping(true)
    setError(null)
    try {
      await stopAgentSession(session.id)
      setConfirming(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStopping(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="mt-1 text-muted-foreground hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
        Parar
      </Button>
      <Dialog open={confirming} onOpenChange={(open) => !open && !stopping && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Interromper este agente?</DialogTitle>
            <DialogDescription>
              O processo PID {session.pid} será encerrado. Alterações que o agente já gravou em disco serão mantidas.
            </DialogDescription>
          </DialogHeader>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="ghost" disabled={stopping} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={stopping} onClick={() => void stop()}>
              {stopping ? 'Interrompendo…' : 'Interromper agente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AgentRow({
  session,
  card,
  onOpenCard,
  historical = false,
}: {
  session: AgentSession
  card?: Card
  onOpenCard: (id: string) => void
  historical?: boolean
}) {
  const meta = STATUS_META[session.status]
  const provider = PROVIDER_META[session.provider]
  return (
    <article
      className={cn(
        'grid gap-3 rounded-xl border bg-card p-4 shadow-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
        historical && '[content-visibility:auto] [contain-intrinsic-size:auto_112px]',
      )}
    >
      <div className="flex min-w-0 gap-3">
        <div
          className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg', provider.className)}
          title={provider.label}
        >
          <HugeiconsIcon icon={provider.icon} strokeWidth={1.8} className="size-5" aria-label={provider.label} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="max-w-full truncate font-sans font-semibold">{session.name ?? session.title}</h3>
            <span className="text-xs text-muted-foreground">{provider.label}</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn('size-2 rounded-full', meta.dot, isActive(session) && 'animate-pulse')} />
              {meta.label}
            </span>
          </div>
          {session.name && session.name !== session.title ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{session.title}</p>
          ) : null}
          {card ? (
            <button
              type="button"
              className={cn(
                'flex max-w-full min-w-0 items-center gap-1.5 text-left text-xs text-primary hover:underline dark:text-chart-2',
                session.name ? 'mt-1.5' : 'mt-2',
              )}
              title={`Abrir ${card.id}: ${card.title}`}
              onClick={() => onOpenCard(card.id)}
            >
              <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.8} className="size-3.5 shrink-0" />
              <span className="truncate">
                <span className="font-mono font-medium">{card.id}</span> · {card.title}
              </span>
            </button>
          ) : (
            <div
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground',
                session.name ? 'mt-1.5' : 'mt-2',
              )}
            >
              <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.8} className="size-3.5 shrink-0" />
              <span className="truncate font-mono" title={session.cwd}>
                {session.cwd || 'Diretório não identificado'}
              </span>
            </div>
          )}
          {session.activity ? (
            <p className="mt-1.5 truncate text-xs text-muted-foreground">{session.activity}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col items-start gap-1 text-xs whitespace-nowrap text-muted-foreground sm:items-end">
        <span className="inline-flex items-center gap-1.5">
          <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.8} className="size-3.5" />
          {isActive(session) ? elapsed(session.startedAt) : DATE_FORMAT.format(new Date(session.updatedAt))}
        </span>
        {session.pid ? <span className="font-mono opacity-70">PID {session.pid}</span> : null}
        {isActive(session) && session.pid ? <StopAgentButton session={session} /> : null}
      </div>
    </article>
  )
}

function LoadingList() {
  return (
    <div className="space-y-3" aria-label="Carregando agentes">
      {[0, 1, 2].map((item) => (
        <Skeleton key={item} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  )
}

export function AgentsPage({ cards, onOpenCard }: { cards: Card[]; onOpenCard: (id: string) => void }) {
  const { sessions, loaded, refreshing, error } = useAgentSessions()
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])

  const { active, recent } = useMemo(() => {
    const current: AgentSession[] = []
    const history: AgentSession[] = []
    for (const session of sessions) (isActive(session) ? current : history).push(session)
    return { active: current, recent: history }
  }, [sessions])
  const activeGroups = useMemo(() => {
    const groups = new Map<string | undefined, AgentSession[]>()
    for (const session of active) {
      const cardId = session.cardId && cardsById.has(session.cardId) ? session.cardId : undefined
      const group = groups.get(cardId)
      if (group) group.push(session)
      else groups.set(cardId, [session])
    }
    return [...groups].sort(([left], [right]) => {
      if (!left) return 1
      if (!right) return -1
      return left.localeCompare(right)
    })
  }, [active, cardsById])

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6" aria-label="Página Agentes">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-primary">
              <HugeiconsIcon icon={SparklesIcon} strokeWidth={1.8} className="size-4" />
              <span className="text-xs font-semibold tracking-wider uppercase">Monitor local</span>
            </div>
            <h2 className="font-sans text-2xl font-semibold tracking-tight">Agentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">Sessões do Claude e Codex detectadas nesta máquina.</p>
          </div>
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refreshAgentSessions(true)}>
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className={cn(refreshing && 'animate-spin')} />
            Atualizar
          </Button>
        </header>

        {error ? (
          <div
            className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {!loaded ? (
          <LoadingList />
        ) : (
          <div className="space-y-8">
            <section aria-labelledby="agents-running-title">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="agents-running-title" className="font-sans text-base font-semibold">
                  Em execução
                </h2>
                <span className="text-xs text-muted-foreground">
                  {active.length} {active.length === 1 ? 'agente' : 'agentes'}
                </span>
              </div>
              {active.length ? (
                <div className="space-y-3">
                  {activeGroups.map(([cardId, group]) => {
                    const card = cardId ? cardsById.get(cardId) : undefined
                    return (
                      <div key={cardId ?? 'sem-card'} className="rounded-xl border bg-muted/20 p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                          {card ? (
                            <button
                              type="button"
                              className="min-w-0 text-left font-sans font-semibold text-primary hover:underline dark:text-chart-2"
                              onClick={() => onOpenCard(card.id)}
                              title={`Abrir ${card.id}: ${card.title}`}
                            >
                              <span className="font-mono">{card.id}</span> · {card.title}
                            </button>
                          ) : (
                            <h3 className="font-sans font-semibold">Sem card</h3>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {group.length} {group.length === 1 ? 'agente' : 'agentes'}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {group.map((session) => (
                            <AgentRow key={session.id} session={session} card={card} onOpenCard={onOpenCard} />
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center">
                  <HugeiconsIcon
                    icon={AiBrain01Icon}
                    strokeWidth={1.5}
                    className="mx-auto mb-3 size-8 text-muted-foreground/60"
                  />
                  <p className="font-sans font-medium">Nenhum agente rodando agora</p>
                  <p className="mt-1 text-xs text-muted-foreground">A lista será atualizada automaticamente.</p>
                </div>
              )}
            </section>

            <section aria-labelledby="agents-recent-title">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="agents-recent-title" className="font-sans text-base font-semibold">
                  Sessões recentes
                </h2>
                <span className="text-xs text-muted-foreground">até 40 sessões locais</span>
              </div>
              {recent.length ? (
                <div className="space-y-3">
                  {recent.map((session) => (
                    <AgentRow
                      key={session.id}
                      session={session}
                      card={session.cardId ? cardsById.get(session.cardId) : undefined}
                      onOpenCard={onOpenCard}
                      historical
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  Nenhuma sessão anterior encontrada.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
