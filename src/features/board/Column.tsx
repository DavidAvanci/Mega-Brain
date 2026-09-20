import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { HugeiconsIcon } from '@hugeicons/react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Card, Status } from '../../../shared/domain/cards'
import { CardView } from '@/features/cards/ui/CardView'
import { deployWindow } from '@/deployWindow'
import { JiraSync } from '@/JiraSync'
import { NewCard } from '@/features/cards/ui/NewCard'
import { STATUS_META } from '@/statusMeta'
import { Tip } from '@/Tip'

function DeployWindowBadge() {
  const { open, next } = deployWindow()
  return (
    <Tip label={open ? 'Dentro da janela de deploy' : `Fora da janela de deploy · próxima: ${next}`}>
      <span
        className={cn(
          'ml-auto inline-flex items-center gap-1 text-[11px]',
          open ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
        )}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-current" />
        {open ? 'aberta' : next}
      </span>
    </Tip>
  )
}

interface Props {
  status: Status
  title: string
  cards: Card[]
  onOpen: (id: string, tab?: string) => void
  onOpenDeployPrs?: () => void
  onNewCard?: () => void
  jiraSync?: boolean
}

export function Column({ status, title, cards, onOpen, onOpenDeployPrs, onNewCard, jiraSync }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const headerRef = useRef<HTMLElement>(null)
  const [isHeaderVisible, setIsHeaderVisible] = useState(true)
  const meta = STATUS_META[status]

  useEffect(() => {
    const header = headerRef.current
    if (!header || !('IntersectionObserver' in window)) return

    const observer = new IntersectionObserver(([entry]) => setIsHeaderVisible(entry.isIntersecting), {
      root: header.closest('main'),
      threshold: 0,
    })

    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={setNodeRef} className="relative h-full">
      <section className={cn('flex max-h-full min-h-24 flex-col rounded-lg border-t-2 bg-muted', meta.accent)}>
        <header ref={headerRef} className="flex items-center gap-2 px-3 py-2.5">
          <HugeiconsIcon icon={meta.icon} strokeWidth={2} className={cn('size-3.5 shrink-0', meta.iconColor)} />
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {onOpenDeployPrs ? (
              <button
                type="button"
                aria-haspopup="dialog"
                className="rounded-sm text-inherit uppercase focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={onOpenDeployPrs}
              >
                {title}
              </button>
            ) : (
              title
            )}
          </h2>
          <Badge variant="secondary" className="h-[18px] min-w-[18px] bg-background px-1 tabular-nums">
            {cards.length}
          </Badge>
          {status === 'aguardando-deploy' && <DeployWindowBadge />}
          {jiraSync && <JiraSync />}
        </header>
        <div className="flex flex-col gap-2 overflow-y-auto px-2 pb-2">
          {onNewCard && <NewCard onClick={onNewCard} />}
          {cards.map((card) => (
            <CardView key={card.id} card={card} onOpen={onOpen} />
          ))}
          {!onNewCard && cards.length === 0 && (
            <div className="grid min-h-16 place-items-center rounded-md border border-dashed bg-background/30 px-3 text-center text-[11px] text-muted-foreground">
              Arraste um card para esta etapa
            </div>
          )}
        </div>
      </section>
      {isOver && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 rounded-lg bg-primary/5 ring-2 ring-primary/40"
        >
          {!isHeaderVisible && (
            <span className="sticky top-1 mx-auto mt-1 block w-fit rounded bg-muted/90 px-2 py-1 text-xs font-medium tracking-wide text-primary uppercase shadow-sm">
              {title}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
