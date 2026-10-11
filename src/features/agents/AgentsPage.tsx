import { useMemo, useState } from 'react'
import {
  AiBrain01Icon,
  ChatGptIcon,
  ClaudeIcon,
  Clock01Icon,
  Task01Icon,
  Refresh01Icon,
  StopIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
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
import { Tip } from '@/Tip'
import type { AgentSession, AgentStatus } from '../../../shared/domain/agents'
import { STATUS_LABELS, type Card } from '../../../shared/domain/cards'
import { isAgentSessionActive, refreshAgentSessions, stopAgentSession, useAgentSessions } from './model/agents-state'

const STATUS_META: Record<AgentStatus, { label: string; dot: string }> = {
  rodando: { label: 'Rodando', dot: 'bg-emerald-500' },
  aguardando: { label: 'Aguardando', dot: 'bg-amber-500' },
  concluido: { label: 'Concluída', dot: 'bg-muted-foreground/50' },
  erro: { label: 'Erro', dot: 'bg-destructive' },
  pausado: { label: 'Pausado', dot: 'bg-muted-foreground' },
  morto: { label: 'Interrompida', dot: 'bg-muted-foreground' },
}
const PROVIDER_META = {
  claude: { label: 'Claude', icon: ClaudeIcon },
  codex: { label: 'Codex', icon: ChatGptIcon },
} as const
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

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function formatCost(costUsd: number): string {
  return `$${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`
}

function displayModel(model: string): string {
  const value = model.trim()
  const isGpt = /^gpt-/i.test(value)
  const normalized = value
    .replace(/^(claude|gpt)-/i, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
    .replace(/-/g, ' ')
  const formatted = normalized.replace(/\b\w+/g, (word) => word[0]?.toUpperCase() + word.slice(1))
  return isGpt ? `GPT ${formatted}` : formatted
}

function StopAgentButton({ session }: { session: AgentSession }) {
  const [confirming, setConfirming] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = async () => {
    setStopping(true)
    setError(null)
    try {
      await stopAgentSession(session.id, session.codexProfileId)
      setConfirming(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setStopping(false)
    }
  }

  return (
    <>
      <Tip label="Parar agente">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Parar agente ${session.name ?? session.title}`}
          onClick={() => setConfirming(true)}
        >
          <HugeiconsIcon icon={StopIcon} strokeWidth={2} />
        </Button>
      </Tip>
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

function AgentRow({ session, card, historical = false }: { session: AgentSession; card?: Card; historical?: boolean }) {
  const meta = STATUS_META[session.status]
  const provider = PROVIDER_META[session.provider]
  return (
    <article
      className={cn(
        'flex min-h-32 min-w-0 flex-col gap-2 rounded-lg border bg-card p-3',
        historical && '[content-visibility:auto] [contain-intrinsic-size:auto_128px]',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn('size-2 shrink-0 rounded-full', meta.dot, isActive(session) && 'animate-pulse')} />
        <h3 className="min-w-0 flex-1 truncate font-sans text-xs font-semibold" title={session.name ?? session.title}>
          {session.name ?? session.title}
        </h3>
        {isActive(session) && session.pid ? <StopAgentButton session={session} /> : null}
      </div>
      {session.name && session.name !== session.title ? (
        <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{session.title}</p>
      ) : session.activity ? (
        <p className="line-clamp-3 text-[11px] leading-snug text-muted-foreground">{session.activity}</p>
      ) : !card ? (
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground" title={session.cwd}>
          <HugeiconsIcon icon={Task01Icon} strokeWidth={1.8} className="size-3 shrink-0" />
          <span className="truncate font-mono">{session.cwd || 'Diretório não identificado'}</span>
        </span>
      ) : null}
      <div className="mt-auto flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title={meta.label}>
          <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.8} className="size-3 shrink-0" />
          <span className="truncate">
            {meta.label} · {session.usage ? formatDuration(session.usage.durationMs) : elapsed(session.startedAt)}
          </span>
        </span>
        {session.provider === 'codex' && session.codexProfileName ? (
          <span
            className="inline-flex max-w-full items-center gap-1.5 truncate text-[10px] text-muted-foreground"
            aria-label={`Perfil: ${session.codexProfileName}`}
          >
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: session.codexProfileColor }}
            />
            <span className="truncate">{session.codexProfileName}</span>
          </span>
        ) : null}
        <span
          className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground"
          title={[provider.label, session.model ? displayModel(session.model) : '', session.effort ?? ''].filter(Boolean).join(' · ')}
          aria-label={[provider.label, session.model ? displayModel(session.model) : '', session.effort ?? ''].filter(Boolean).join(' · ')}
        >
          <HugeiconsIcon icon={provider.icon} strokeWidth={1.8} className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {session.model ? displayModel(session.model) : ''}
            {session.effort ? ` · ${session.effort[0]?.toUpperCase()}${session.effort.slice(1)}` : ''}
          </span>
          {session.usage ? (
            <span
              className="shrink-0 font-medium tabular-nums"
              title={session.usage.costUsd === undefined ? 'Custo indisponível para esta sessão' : 'Custo estimado'}
            >
              {session.usage.costUsd === undefined ? '$—' : formatCost(session.usage.costUsd)}
            </span>
          ) : null}
        </span>
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

function groupSessions(sessions: AgentSession[], cardsById: Map<string, Card>) {
  const groups = new Map<string | undefined, AgentSession[]>()
  for (const session of sessions) {
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
}

function AgentGroups({
  groups,
  cardsById,
  onOpenCard,
  historical = false,
}: {
  groups: ReturnType<typeof groupSessions>
  cardsById: Map<string, Card>
  onOpenCard: (id: string) => void
  historical?: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {groups.map(([cardId, group]) => {
        const card = cardId ? cardsById.get(cardId) : undefined
        return (
          <AgentGroup
            key={cardId ?? 'sem-card'}
            group={group}
            card={card}
            onOpenCard={onOpenCard}
            historical={historical}
          />
        )
      })}
    </div>
  )
}

function AgentGroup({
  group,
  card,
  onOpenCard,
  historical,
}: {
  group: AgentSession[]
  card?: Card
  onOpenCard: (id: string) => void
  historical: boolean
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3 px-1">
        {card ? (
          <button
            type="button"
            className="min-w-0 truncate text-left font-sans font-semibold text-primary hover:underline dark:text-chart-2"
            onClick={() => onOpenCard(card.id)}
            title={`Abrir ${card.id}: ${card.title}`}
          >
            {card.title}
          </button>
        ) : (
          <h3 className="min-w-0 truncate font-sans font-semibold">Sem card</h3>
        )}
        {card ? (
          <Badge variant="outline" className="font-mono" aria-label={`ID do card: ${card.id}`}>
            {card.id}
          </Badge>
        ) : null}
      </div>
      <div className="mb-3 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        {card ? <span className="truncate">{STATUS_LABELS[card.status]}</span> : <span />}
        <span className="shrink-0">
          {group.length} {group.length === 1 ? 'agente' : 'agentes'}
        </span>
      </div>
      <div
        className={cn('grid grid-cols-2 gap-2 lg:grid-cols-4', group.length > 8 && 'max-h-96 overflow-y-auto pr-1')}
        tabIndex={group.length > 8 ? 0 : undefined}
        aria-label={`Agentes de ${card?.title ?? 'sessões sem card'}`}
      >
        {group.map((session) => (
          <AgentRow
            key={`${session.codexProfileId ?? session.provider}:${session.id}`}
            session={session}
            card={card}
            historical={historical}
          />
        ))}
      </div>
    </div>
  )
}

export function AgentsPage({ cards, onOpenCard }: { cards: Card[]; onOpenCard: (id: string) => void }) {
  const { sessions, loaded, refreshing, error } = useAgentSessions()
  const [selectedProfile, setSelectedProfile] = useState('')
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const profileOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const session of sessions) {
      if (session.provider === 'claude') options.set('claude', 'Claude')
      else
        options.set(
          `codex:${session.codexProfileId ?? ''}`,
          session.codexProfileName ?? 'Codex · perfil não identificado',
        )
    }
    return [...options].sort((left, right) => left[1].localeCompare(right[1], 'pt-BR'))
  }, [sessions])
  const profileFilter = profileOptions.some(([id]) => id === selectedProfile) ? selectedProfile : ''

  const { active, recent } = useMemo(() => {
    const current: AgentSession[] = []
    const history: AgentSession[] = []
    for (const session of sessions) {
      const profile = session.provider === 'claude' ? 'claude' : `codex:${session.codexProfileId ?? ''}`
      if (profileFilter && profile !== profileFilter) continue
      const bucket = isActive(session) ? current : history
      bucket.push(session)
    }
    return { active: current, recent: history }
  }, [sessions, profileFilter])
  const activeGroups = useMemo(() => groupSessions(active, cardsById), [active, cardsById])
  const recentGroups = useMemo(() => groupSessions(recent, cardsById), [recent, cardsById])

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6" aria-label="Página Agentes">
      <div className="mx-auto max-w-none">
        <header className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-4 border-b pb-4">
          <div className="min-w-48 flex-1">
            <h2 className="font-sans text-2xl font-semibold tracking-tight">Agentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitor local · Sessões do Claude e Codex detectadas nesta máquina.
            </p>
          </div>
          <div
            className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card/70 px-4 py-3 sm:grid-cols-4"
            aria-label="Resumo das sessões"
          >
            {[
              { label: 'Ativos', value: active.length, dot: 'bg-primary' },
              {
                label: 'Rodando',
                value: active.filter((session) => session.status === 'rodando').length,
                dot: 'bg-emerald-500',
              },
              {
                label: 'Aguardando',
                value: active.filter((session) => session.status === 'aguardando').length,
                dot: 'bg-amber-500',
              },
              { label: 'Recentes', value: recent.length, dot: 'bg-muted-foreground/60' },
            ].map((item) => (
              <div key={item.label} className="flex min-w-0 flex-col gap-1">
                <span className="text-xl font-semibold leading-none tabular-nums">{item.value}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn('size-1.5 rounded-full', item.dot)} />
                  {item.label}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {profileOptions.length > 1 && (
              <AppSelect
                ariaLabel="Filtrar por perfil"
                className="w-auto min-w-40 max-w-56"
                compact
                value={profileFilter}
                onValueChange={setSelectedProfile}
                options={[
                  { value: '', label: 'Todos os perfis' },
                  ...profileOptions.map(([value, label]) => ({ value, label })),
                ]}
              />
            )}
            <Tip label="Atualizar agentes">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Atualizar agentes"
                disabled={refreshing}
                onClick={() => void refreshAgentSessions(true)}
              >
                <HugeiconsIcon
                  icon={Refresh01Icon}
                  strokeWidth={2}
                  className={cn('size-4', refreshing && 'animate-spin')}
                />
              </Button>
            </Tip>
          </div>
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
                <AgentGroups groups={activeGroups} cardsById={cardsById} onOpenCard={onOpenCard} />
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
                <AgentGroups groups={recentGroups} cardsById={cardsById} onOpenCard={onOpenCard} historical />
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
