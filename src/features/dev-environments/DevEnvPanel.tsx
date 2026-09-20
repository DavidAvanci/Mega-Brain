import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, MonitorPlayIcon, Refresh01Icon } from '@hugeicons/core-free-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { openDevEnv, openDevEnvAgent, startDevEnv, stopDevEnv } from '@/features/cards/model/card-commands'
import { Tip } from '@/Tip'
import type { DevEnvApp, DevEnvAppStatus } from '../../../shared/domain/agents'
import type { Card } from '../../../shared/domain/cards'

const APP_STATUS: Record<DevEnvAppStatus, string> = {
  aguardando: 'aguardando',
  instalando: 'instalando deps…',
  subindo: 'subindo…',
  rodando: 'rodando',
  erro: 'erro',
  parado: 'parado',
}

function AppLine({ app, cardId }: { app: DevEnvApp; cardId: string }) {
  return (
    <Tip label={app.note}>
      <div className="flex items-center gap-1.5 text-[11px]">
        {app.status === 'rodando' && app.url ? (
          <button
            type="button"
            className="truncate text-primary hover:underline dark:text-chart-2"
            onClick={(event) => {
              event.stopPropagation()
              void openDevEnv(cardId, app.repo)
            }}
          >
            {app.repo} — {app.url}
          </button>
        ) : (
          <span className={cn('truncate text-muted-foreground', app.status === 'erro' && 'text-destructive')}>
            {app.repo} — {APP_STATUS[app.status]}
          </span>
        )}
        {app.source === 'master' && (
          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] uppercase">
            master
          </Badge>
        )}
        {app.note && <span className="shrink-0 text-amber-600 dark:text-amber-400">⚠</span>}
      </div>
    </Tip>
  )
}

export function DevEnvPanel({ card }: { card: Card }) {
  const env = card.devEnv
  const [options, setOptions] = useState<string[] | null>(null)
  const [pending, setPending] = useState(false)

  const start = async (frontend?: string) => {
    if (pending) return
    setPending(true)
    setOptions(await startDevEnv(card.id, frontend))
    setPending(false)
  }

  const stop = async () => {
    if (pending) return
    setPending(true)
    await stopDevEnv(card.id)
    setPending(false)
  }

  const retry = async () => {
    if (pending) return
    setPending(true)
    await stopDevEnv(card.id)
    setOptions(await startDevEnv(card.id))
    setPending(false)
  }

  const stopBubbling = (e: React.SyntheticEvent) => e.stopPropagation()

  if (options) {
    return (
      <div className="mt-2 flex flex-col gap-1" onClick={stopBubbling} onPointerDown={stopBubbling}>
        <span className="text-[11px] text-muted-foreground">Só o backend mudou — qual frontend subir?</span>
        {options.map((repo) => (
          <Button key={repo} size="xs" variant="outline" className="justify-start" onClick={() => start(repo)}>
            {repo}
          </Button>
        ))}
        <Button size="xs" variant="ghost" onClick={() => setOptions(null)}>
          Cancelar
        </Button>
      </div>
    )
  }

  if (!env || env.status === 'parado') {
    return (
      <Tip label="Detecta os repos tocados e sobe backend/frontends localmente">
        <Button
          variant="outline"
          size="xs"
          className="mt-2 w-full text-muted-foreground"
          disabled={pending}
          onClick={(e) => {
            stopBubbling(e)
            start()
          }}
          onPointerDown={stopBubbling}
        >
          {pending ? <Spinner className="size-3" /> : <HugeiconsIcon icon={MonitorPlayIcon} strokeWidth={2} />}
          Iniciar ambiente dev
        </Button>
      </Tip>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-1 rounded-md border p-2" onClick={stopBubbling} onPointerDown={stopBubbling}>
      {env.status === 'subindo' && (
        <div className="flex items-center gap-1.5 text-[11px] text-primary">
          <Spinner className="size-3" />
          {env.phase ?? 'Subindo ambiente…'}
        </div>
      )}
      {env.status === 'erro' && (
        <p className="text-[11px] text-destructive">{env.error ?? 'Erro ao subir o ambiente'}</p>
      )}
      {env.warnings?.map((warning) => (
        <p key={warning} className="text-[11px] text-amber-600 dark:text-amber-400">
          {warning}
        </p>
      ))}
      {env.apps.map((app) => (
        <AppLine key={app.repo} app={app} cardId={card.id} />
      ))}
      <div className="mt-1 flex gap-1.5">
        {env.status === 'erro' ? (
          <>
            <Tip label="Tentar de novo">
              <Button size="xs" variant="outline" disabled={pending} onClick={retry}>
                <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
              </Button>
            </Tip>
            <Tip label="Cancelar tentativa">
              <Button size="xs" variant="outline" disabled={pending} onClick={stop}>
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </Tip>
            <Tip label="Abre um terminal com o agente configurado rodando /run-test-env">
              <Button
                size="xs"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => openDevEnvAgent(card.id)}
              >
                Rodar com agente
              </Button>
            </Tip>
          </>
        ) : (
          <Button size="xs" variant="ghost" className="text-muted-foreground" disabled={pending} onClick={stop}>
            {env.status === 'subindo' ? 'Cancelar' : 'Parar ambiente'}
          </Button>
        )}
      </div>
    </div>
  )
}
