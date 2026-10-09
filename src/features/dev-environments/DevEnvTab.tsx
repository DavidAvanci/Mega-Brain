import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { openDevEnv, stopDevEnv } from '@/features/cards/model/card-commands'
import type { Card } from '../../../shared/domain/cards'
import type { DevEnvInfo } from '../../../shared/domain/agents'
import { devEnvDiagnosis, type DevEnvPreview, type DevEnvStartOptions } from '../../../shared/domain/dev-environments'
import { fetchDevEnv, previewDevEnv } from './dev-env-api'
import { DevEnvConfiguration } from './DevEnvConfiguration'
import { DevEnvLogs } from './DevEnvLogs'
import { DevEnvPorts } from './DevEnvPorts'

export function DevEnvTab({
  card,
  agentRunning,
  onEnvironmentChat,
}: {
  card: Card
  agentRunning: boolean
  onEnvironmentChat: (text?: string, configuration?: DevEnvStartOptions) => void
}) {
  const [env, setEnv] = useState<DevEnvInfo | null>(card.devEnv ?? null)
  const [preview, setPreview] = useState<DevEnvPreview | null>(null)
  const [plan, setPlan] = useState<DevEnvPreview | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configurationKey = JSON.stringify(env?.configuration)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await previewDevEnv(card.id)
        if (!cancelled) {
          setPlan(result)
          setPlanError(null)
        }
      } catch (failure) {
        if (!cancelled) setPlanError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [card.id, agentRunning, configurationKey])
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const result = await fetchDevEnv(card.id)
        if (!cancelled) setEnv(result)
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [card.id])
  const configure = async () => {
    setPending(true)
    setError(null)
    try {
      const result = await previewDevEnv(card.id)
      setPlan(result)
      setPlanError(null)
      setPreview(result)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPending(false)
    }
  }
  const stop = async () => {
    setPending(true)
    setError(null)
    try {
      await stopDevEnv(card.id)
      setEnv(await fetchDevEnv(card.id))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPending(false)
    }
  }
  const ask = (message: string, configuration?: DevEnvStartOptions) => {
    onEnvironmentChat(message, configuration)
  }
  const diagnosis = env?.status === 'erro' ? devEnvDiagnosis(env) : null
  const starting = env?.status === 'subindo'
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
      <div className="max-h-[55%] shrink-0 space-y-3 overflow-y-auto pb-1">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Ambientes de desenvolvimento</h2>
            <p className="mt-1 max-w-lg text-xs text-muted-foreground">
              Escolha os projetos e as portas, acompanhe os logs ou peça ajuda ao agente.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-10"
              disabled={pending || agentRunning || starting}
              onClick={() => void configure()}
            >
              {pending && <Spinner className="size-4" />}Configurar ambiente
            </Button>
            <Button variant="outline" className="min-h-10" onClick={() => onEnvironmentChat()}>
              Pedir ao agente
            </Button>
            {env && env.status !== 'parado' && (
              <Button variant="outline" className="min-h-10" disabled={pending} onClick={() => void stop()}>
                {starting ? 'Cancelar inicialização' : 'Parar ambiente'}
              </Button>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {diagnosis && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="text-sm font-semibold text-destructive">{diagnosis.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{diagnosis.detail}</p>
            {env?.failure?.phase && <p className="mt-1 text-xs text-muted-foreground">Etapa: {env.failure.phase}</p>}
            <p className="mt-2 text-xs">{diagnosis.nextStep}</p>
            <Button
              variant="outline"
              className="mt-3 min-h-10"
              disabled={agentRunning}
              onClick={() =>
                ask(
                  'Diagnostique a falha do ambiente usando os logs e a configuração atual. Explique a causa e corrija o necessário para tentar iniciar os projetos selecionados novamente.',
                )
              }
            >
              Diagnosticar com agente
            </Button>
          </div>
        )}
        {starting && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Spinner className="size-4" />
            {env?.phase ?? 'Iniciando ambiente…'}
          </p>
        )}
        <DevEnvPorts
          apps={env?.apps ?? []}
          projects={plan?.projects}
          onOpen={(repo) => void openDevEnv(card.id, repo)}
        />
        {planError && (
          <p className="text-xs text-muted-foreground">Não foi possível atualizar as portas previstas: {planError}</p>
        )}
        {env?.warnings?.map((warning) => (
          <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
            {warning}
          </p>
        ))}
      </div>
      <DevEnvLogs
        cardId={card.id}
        failedRepo={env?.failure?.repo ?? env?.apps.find((app) => app.status === 'erro')?.repo}
      />
      {preview && (
        <DevEnvConfiguration
          cardId={card.id}
          preview={preview}
          onClose={() => setPreview(null)}
          onStartWithAgent={(configuration) => {
            setPreview(null)
            ask(
              'Prepare e inicie o ambiente com os projetos, portas e opção de Docker selecionados. Acompanhe a inicialização e investigue qualquer falha nos logs.',
              configuration,
            )
          }}
        />
      )}
    </div>
  )
}
