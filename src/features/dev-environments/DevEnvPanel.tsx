import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, MonitorPlayIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { Card } from '../../../shared/domain/cards'

export function DevEnvPanel({ card, onOpen }: { card: Card; onOpen?: () => void }) {
  const env = card.devEnv
  const failed = env?.failure?.repo ?? env?.apps.find((app) => app.status === 'erro')?.repo
  const label =
    env?.status === 'erro'
      ? `Ambiente com falha${failed ? ` · ${failed}` : ''}`
      : env?.status === 'subindo'
        ? 'Iniciando ambiente…'
        : env?.status === 'rodando'
          ? `${env.apps.filter((app) => app.status === 'rodando').length} projetos rodando`
          : 'Ambientes de desenvolvimento'
  return (
    <Button
      variant="outline"
      aria-label="Abrir aba Ambientes"
      title={label}
      className={cn(
        'mt-2 min-h-10 w-full justify-start gap-2 text-xs text-muted-foreground',
        env?.status === 'erro' && 'text-destructive',
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onOpen?.()
      }}
    >
      {env?.status === 'subindo' ? (
        <Spinner className="size-3.5" />
      ) : (
        <HugeiconsIcon
          icon={env?.status === 'erro' ? TriangleAlertIcon : MonitorPlayIcon}
          className="size-3.5"
          strokeWidth={2}
        />
      )}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" strokeWidth={2} />
    </Button>
  )
}
