import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Tip } from './Tip'
import type { ClaudeUsage, UsageWindow } from '../shared/contracts/usage'
import { apiClient } from './shared/api/api-client'
import { formatUsageReset } from './usage-statistics'

const POLL_INTERVAL = 60_000
const COUNTDOWN_INTERVAL = 15_000

function levelClass(utilization: number): string {
  if (utilization >= 90) return 'text-destructive'
  if (utilization >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

function Meter({
  label,
  usage,
  name,
  stacked,
  provider,
  now,
}: {
  label: string
  usage: UsageWindow
  name: string
  stacked: boolean
  provider: string
  now: number
}) {
  const pct = Math.round(Math.max(0, Math.min(100, usage.utilization)))
  const available = 100 - pct
  const reset = formatUsageReset(usage.resetsAt, now)
  const description = `${pct}% usado · ${available}% disponível · ${reset.label}`
  return (
    <Tip
      side={stacked ? 'right' : 'bottom'}
      label={`Uso do ${provider} (${name}): ${description}${reset.fullDateLabel ? ` · ${reset.fullDateLabel}` : ''}`}
    >
      <span className={cn('flex min-w-0 flex-col gap-1 text-xs tabular-nums', stacked ? 'w-full' : 'w-44')}>
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{label}</span>
          <span className={levelClass(pct)}>{pct}% usado</span>
        </span>
        <span
          role="meter"
          aria-label={`Uso do ${provider} (${name})`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={description}
          className={cn('my-0.5 h-1.5 overflow-hidden rounded-full bg-muted', levelClass(pct))}
        >
          <span className="block h-full rounded-full bg-current" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-foreground">{reset.label}</span>
        <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          <span>{available}% disponível</span>
          {reset.dateTime && (
            <time dateTime={reset.dateTime} title={reset.fullDateLabel ?? undefined}>
              {reset.dateLabel}
            </time>
          )}
        </span>
      </span>
    </Tip>
  )
}

export function UsageMeter({
  className,
  layout = 'inline',
  provider = 'claude',
}: {
  className?: string
  layout?: 'inline' | 'stacked'
  provider?: 'claude' | 'codex'
}) {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    let loading = false
    let reloadPending = false
    const load = async () => {
      if (loading) {
        reloadPending = true
        return
      }
      loading = true
      try {
        const data = await apiClient().json<ClaudeUsage>(`/api/${provider}/usage`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        })
        if (!data || typeof data !== 'object') throw new Error('Resposta de uso inválida')
        if (active)
          setUsage((previous) =>
            data.fiveHour || data.sevenDay || data.fable
              ? data
              : {
                  ...(provider !== 'codex' || previous?.codexProfileId === data.codexProfileId
                    ? (previous ?? data)
                    : data),
                  codexProfileId: data.codexProfileId,
                  codexProfileName: data.codexProfileName,
                  stale: true,
                },
          )
      } catch {
        if (active)
          setUsage((previous) => ({
            ...(previous ?? { fiveHour: null, sevenDay: null, fable: null }),
            stale: true,
          }))
      } finally {
        loading = false
        if (active && reloadPending) {
          reloadPending = false
          void load()
        }
      }
    }
    const refresh = () => {
      setNow(Date.now())
      void load()
    }
    refresh()
    const timer = window.setInterval(refresh, POLL_INTERVAL)
    const countdown = window.setInterval(() => setNow(Date.now()), COUNTDOWN_INTERVAL)
    window.addEventListener('focus', refresh)
    if (provider === 'codex') window.addEventListener('megabrain:codex-profiles-changed', refresh)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(timer)
      window.clearInterval(countdown)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('megabrain:codex-profiles-changed', refresh)
    }
  }, [provider])

  const stacked = layout === 'stacked'
  const hasUsage = Boolean(usage?.fiveHour || usage?.sevenDay || usage?.fable)

  return (
    <span
      className={cn(
        'flex min-w-0',
        stacked ? 'flex-col items-stretch gap-3' : 'flex-wrap items-center gap-3',
        className,
      )}
    >
      {provider === 'codex' && usage?.codexProfileName && (
        <span
          className="truncate text-[10px] text-muted-foreground"
          title={`Consumo do perfil ${usage.codexProfileName}`}
        >
          {usage.codexProfileName}
        </span>
      )}
      {!hasUsage && (
        <span role="status" className="text-xs text-muted-foreground">
          {usage
            ? (usage.unavailableReason ??
              `Não foi possível consultar o ${provider === 'codex' ? 'Codex' : 'Claude'}. Verifique o login.`)
            : 'Carregando consumo…'}
        </span>
      )}
      {hasUsage && usage?.stale && (
        <span
          role="status"
          className="text-xs text-amber-600 dark:text-amber-400"
          title={
            usage.updatedAt ? `Última atualização: ${new Date(usage.updatedAt).toLocaleString('pt-BR')}` : undefined
          }
        >
          Dados desatualizados
        </span>
      )}
      {usage?.fiveHour && (
        <Meter
          label="5h"
          provider={provider === 'codex' ? 'Codex' : 'Claude'}
          name="janela de 5 horas"
          usage={usage.fiveHour}
          stacked={stacked}
          now={now}
        />
      )}
      {usage?.sevenDay && (
        <Meter
          label="7d"
          provider={provider === 'codex' ? 'Codex' : 'Claude'}
          name="janela de 7 dias"
          usage={usage.sevenDay}
          stacked={stacked}
          now={now}
        />
      )}
      {usage?.fable && (
        <Meter label="Modelo" provider="Claude" name="modelo, 7 dias" usage={usage.fable} stacked={stacked} now={now} />
      )}
    </span>
  )
}
