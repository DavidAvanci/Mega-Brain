import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Tip } from './Tip'
import type { ClaudeUsage, UsageWindow } from './types'
import { apiClient } from './apiClient'

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

function Meter({ label, usage, name }: { label: string; usage: UsageWindow; name: string }) {
  const pct = Math.round(usage.utilization)
  return (
    <Tip side="bottom" label={`Uso do Claude (${name}): ${pct}%${resetLabel(usage)}`}>
      <span
        className={cn(
          'flex items-center gap-1.5 text-[11px] tabular-nums',
          levelClass(usage.utilization),
        )}
      >
        {label}
        <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-current"
            style={{ width: `${Math.min(100, usage.utilization)}%` }}
          />
        </span>
        {pct}%
      </span>
    </Tip>
  )
}

export function UsageMeter({ className }: { className?: string }) {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await apiClient().json<ClaudeUsage>('/api/claude/usage')
        if (active) setUsage(data)
      } catch {}
    }
    load()
    const timer = window.setInterval(load, POLL_INTERVAL)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <span className={cn('flex items-center gap-3', className)}>
      {usage?.fiveHour && <Meter label="5h" name="janela de 5 horas" usage={usage.fiveHour} />}
      {usage?.sevenDay && <Meter label="7d" name="janela de 7 dias" usage={usage.sevenDay} />}
      {usage?.fable && <Meter label="Fable" name="Fable, 7 dias" usage={usage.fable} />}
    </span>
  )
}
