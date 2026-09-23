import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Tip } from './Tip'
import type { ClaudeUsage, UsageWindow } from '../shared/contracts/usage'
import { apiClient } from './shared/api/api-client'

const POLL_INTERVAL = 60_000

function levelClass(utilization: number): string {
  if (utilization >= 90) return 'text-destructive'
  if (utilization >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

function resetLabel(usage: UsageWindow): string {
  if (!usage.resetsAt) return ''
  const at = new Date(usage.resetsAt).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  return ` · reseta ${at}`
}

function Meter({
  label,
  usage,
  name,
  stacked,
}: {
  label: string
  usage: UsageWindow
  name: string
  stacked: boolean
}) {
  const pct = Math.round(usage.utilization)
  return (
    <Tip side={stacked ? 'right' : 'bottom'} label={`Uso do Claude (${name}): ${pct}%${resetLabel(usage)}`}>
      <span
        className={cn(
          'items-center gap-2 text-xs tabular-nums',
          stacked ? 'grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.25rem]' : 'flex',
          levelClass(usage.utilization),
        )}
      >
        {label}
        <span className={cn('h-2 overflow-hidden rounded-full bg-muted', stacked ? 'w-full' : 'w-12')}>
          <span
            className="block h-full rounded-full bg-current"
            style={{ width: `${Math.min(100, usage.utilization)}%` }}
          />
        </span>
        <span className={cn(stacked && 'text-right')}>{pct}%</span>
      </span>
    </Tip>
  )
}

export function UsageMeter({
  className,
  layout = 'inline',
}: {
  className?: string
  layout?: 'inline' | 'stacked'
}) {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    let loading = false
    const load = async () => {
      if (loading) return
      loading = true
      try {
        const data = await apiClient().json<ClaudeUsage>('/api/claude/usage', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        })
        if (active)
          setUsage((previous) =>
            data.fiveHour || data.sevenDay || data.fable ? data : { ...(previous ?? data), stale: true },
          )
      } catch {
        if (active)
          setUsage((previous) => ({
            ...(previous ?? { fiveHour: null, sevenDay: null, fable: null }),
            stale: true,
          }))
      } finally {
        loading = false
      }
    }
    load()
    const timer = window.setInterval(load, POLL_INTERVAL)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  const stacked = layout === 'stacked'
  const hasUsage = Boolean(usage?.fiveHour || usage?.sevenDay || usage?.fable)

  return (
    <span className={cn('flex', stacked ? 'flex-col items-stretch gap-2.5' : 'items-center gap-3', className)}>
      {!hasUsage && (
        <span role="status" className="text-xs text-muted-foreground">
          {usage ? 'Consumo indisponível' : 'Carregando consumo…'}
        </span>
      )}
      {hasUsage && usage?.stale && (
        <span
          role="status"
          className="text-xs text-amber-600 dark:text-amber-400"
          title={usage.updatedAt ? `Última atualização: ${new Date(usage.updatedAt).toLocaleString('pt-BR')}` : undefined}
        >
          Dados desatualizados
        </span>
      )}
      {usage?.fiveHour && <Meter label="5h" name="janela de 5 horas" usage={usage.fiveHour} stacked={stacked} />}
      {usage?.sevenDay && <Meter label="7d" name="janela de 7 dias" usage={usage.sevenDay} stacked={stacked} />}
      {usage?.fable && <Meter label="Fable" name="Fable, 7 dias" usage={usage.fable} stacked={stacked} />}
    </span>
  )
}
