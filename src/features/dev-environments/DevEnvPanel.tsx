import { useState, type MouseEvent } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, CancelSquareIcon, MonitorPlayIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { openDevEnv, stopDevEnvProject } from '@/features/cards/model/card-commands'
import { cn } from '@/lib/utils'
import type { Card } from '../../../shared/domain/cards'
import type { DevEnvApp } from '../../../shared/domain/agents'

function appPort(app: DevEnvApp): string {
  if (app.port !== undefined) return String(app.port)
  if (!app.url) return ''
  try {
    return new URL(app.url).port
  } catch {
    return ''
  }
}

export function DevEnvPanel({ card, onOpen }: { card: Card; onOpen?: () => void }) {
  const [stopping, setStopping] = useState<string | null>(null)
  const env = card.devEnv
  const runningApps = env?.apps.filter((app) => app.status === 'rodando') ?? []
  const failed = env?.failure?.repo ?? env?.apps.find((app) => app.status === 'erro')?.repo
  const label =
    env?.status === 'erro'
      ? `Ambiente com falha${failed ? ` · ${failed}` : ''}`
      : env?.status === 'subindo'
        ? 'Iniciando ambiente…'
        : env?.status === 'rodando' && runningApps.length
          ? 'Projetos do ambiente em execução'
          : 'Iniciar ambiente dev'
  const stop = async (event: MouseEvent<HTMLButtonElement>, repo: string) => {
    event.stopPropagation()
    setStopping(repo)
    try {
      await stopDevEnvProject(card.id, repo)
    } finally {
      setStopping(null)
    }
  }

  if (env?.status === 'rodando' && runningApps.length) {
    return (
      <div
        className="mt-2 flex min-w-0 flex-col gap-1 rounded-md border bg-muted/20 p-1.5"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {runningApps.map((app) => {
          const port = appPort(app)
          return (
            <div key={app.repo} className="flex min-w-0 items-center justify-between gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Abrir ${app.repo} na porta ${port || 'desconhecida'}`}
                title={`Abrir ${app.repo} na porta ${port || 'desconhecida'}`}
                className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-2 text-xs font-normal text-green-700 dark:text-green-400"
                onClick={() => void openDevEnv(card.id, app.repo)}
              >
                <span className="max-w-32 truncate">{app.repo}</span>
                <span aria-hidden="true">•</span>
                <span className="shrink-0 tabular-nums">{port || '—'}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={stopping !== null}
                aria-label={stopping === app.repo ? `Parando ${app.repo}` : `Parar ${app.repo}`}
                title={stopping === app.repo ? `Parando ${app.repo}` : `Parar ${app.repo}`}
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(event) => void stop(event, app.repo)}
              >
                {stopping === app.repo ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <HugeiconsIcon icon={CancelSquareIcon} className="size-3.5" strokeWidth={2} />
                )}
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      aria-label="Iniciar ambiente dev"
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
