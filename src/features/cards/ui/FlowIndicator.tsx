import { cn } from '@/lib/utils'
import { Tip } from '@/Tip'
import { FLOW_LABELS, type FlowLevel } from '../../../../shared/domain/cards'

const FLOW_STRENGTH: Record<FlowLevel, number> = {
  simples: 1,
  medio: 2,
  dificil: 3,
}

const BAR_HEIGHTS = ['h-1', 'h-2', 'h-3'] as const

export function FlowIndicator({ flow, className }: { flow: FlowLevel; className?: string }) {
  const activeBars = FLOW_STRENGTH[flow]
  const label = `Complexidade: ${FLOW_LABELS[flow]}`

  return (
    <Tip label={label}>
      <span
        role="img"
        aria-label={label}
        className={cn(
          'inline-grid h-3 w-[18px] shrink-0 grid-cols-3 items-end gap-0.5 text-muted-foreground',
          className,
        )}
      >
        {BAR_HEIGHTS.map((height, index) => (
          <span
            key={height}
            aria-hidden="true"
            className={cn('w-full rounded-sm bg-current', height, index >= activeBars && 'opacity-20')}
          />
        ))}
      </span>
    </Tip>
  )
}
