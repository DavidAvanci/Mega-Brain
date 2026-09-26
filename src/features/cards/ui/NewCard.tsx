import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RepositoryMentionTextarea } from '@/components/RepositoryMentionTextarea'
import { AppSelect } from '@/components/ui/select'
import { createCard } from '../model/card-commands'
import { fetchMegaBrainSettings } from '../api/card-detail-api'
import { useCardTriage } from '../model/useCardTriage'
import { TRIAGE_UNAVAILABLE_MESSAGES } from '../../../../shared/domain/card-triage'
import { FLOW_DESCRIPTIONS, FLOW_LABELS, FLOW_LEVELS, type FlowLevel } from '../../../../shared/domain/cards'

function CardForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [flow, setFlow] = useState<FlowLevel>('dificil')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [layaEnabled, setLayaEnabled] = useState<boolean | null>(null)
  const triage = useCardTriage()
  useEffect(() => {
    let mounted = true
    void fetchMegaBrainSettings()
      .then((settings) => {
        if (mounted) setLayaEnabled(settings.general.layaEnabled)
      })
      .catch(() => {
        if (mounted) setError('Não foi possível carregar as configurações. Tente abrir o formulário novamente.')
      })
    return () => {
      mounted = false
    }
  }, [])

  const edit = (field: 'title' | 'description', value: string) => {
    triage.invalidate()
    setError(null)
    if (field === 'title') setTitle(value)
    else setDescription(value)
  }

  const close = () => {
    triage.invalidate()
    setTitle('')
    setDescription('')
    setFlow('dificil')
    setError(null)
    onDone()
  }

  const create = async (selectedFlow: FlowLevel, usedSuggestion = false) => {
    const trimmed = title.trim()
    if (!trimmed || pending) return
    setPending(true)
    setError(null)
    try {
      await createCard(trimmed, description, selectedFlow)
      if (layaEnabled) {
        const suggestion = usedSuggestion && triage.state.status === 'suggested' ? triage.state : undefined
        const evidence = suggestion?.evidence
        toast.success(`Card criado como ${FLOW_LABELS[selectedFlow]}`, {
          description: evidence
            ? `Laya ${evidence.source === 'cache' ? '(cache)' : '(gateway)'} · ${suggestion?.modelVersion} · análise ${evidence.analysisId}`
            : 'Criado sem aplicar uma sugestão da Laya.',
        })
      }
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  const analyze = () => {
    if (!title.trim() || title.trim().length > 500 || description.length > 12000 || pending) return
    setError(null)
    void triage.suggest(title.trim(), description)
  }

  const primaryAction = () => {
    if (layaEnabled) {
      if (triage.state.status === 'suggested') void create(triage.state.suggestedFlow, true)
      else analyze()
    } else if (layaEnabled === false) void create(flow)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      primaryAction()
    } else if (e.key === 'Escape') close()
  }
  const validInput = Boolean(title.trim()) && title.trim().length <= 500 && description.length <= 12000
  const result = triage.state
  const hasResponse = result.status === 'suggested'

  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        disabled={pending}
        placeholder="Título"
        value={title}
        className="bg-card"
        onChange={(e) => edit('title', e.target.value)}
        onKeyDown={onKeyDown}
      />
      <RepositoryMentionTextarea
        aria-label="Descrição do card"
        disabled={pending}
        placeholder="Descrição (vai pro card.json da pasta)"
        value={description}
        rows={4}
        className="resize-none bg-card"
        onValueChange={(value) => edit('description', value)}
        onKeyDown={onKeyDown}
      />
      {layaEnabled === false && (
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Nível do fluxo
          <AppSelect
            value={flow}
            ariaLabel="Nível do fluxo"
            onValueChange={setFlow}
            options={FLOW_LEVELS.map((level) => ({ value: level, label: FLOW_LABELS[level] }))}
            className="bg-card"
          />
          <span className="font-normal">{FLOW_DESCRIPTIONS[flow]}</span>
        </label>
      )}
      {layaEnabled && (
        <div className="grid gap-2 text-xs" aria-live="polite">
          <p className="text-muted-foreground">
            A Laya analisará o título e a descrição antes da criação. O fluxo padrão sem sugestão é Difícil.
          </p>
          {result.status === 'loading' && <p role="status">Consultando o gateway Laya…</p>}
          {hasResponse && (
            <div className="grid gap-1 rounded-md border p-3" data-testid="laya-response">
              <p className="font-medium">
                {result.evidence?.source === 'cache'
                  ? 'Resultado em cache de uma resposta da Laya'
                  : 'Resposta recebida da Laya'}
              </p>
              <p>Sugestão: {FLOW_LABELS[result.suggestedFlow]}</p>
              <div className="grid gap-1" aria-label="Probabilidades da Laya">
                {FLOW_LEVELS.map((level) => (
                  <div key={level} className="flex justify-between gap-3">
                    <span>{FLOW_LABELS[level]}</span>
                    <span>
                      {(result.probabilities[level] * 100).toLocaleString('pt-BR', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                      %
                    </span>
                  </div>
                ))}
              </div>
              {result.evidence && (
                <div className="text-muted-foreground">
                  <p>Modelo: {result.modelVersion}</p>
                  <p>Processada em: {new Date(result.evidence.processedAt).toLocaleString('pt-BR')}</p>
                  <p>
                    Tempo: {result.evidence.durationMs} ms
                    {result.evidence.gatewayMs === undefined ? '' : ` · gateway: ${result.evidence.gatewayMs} ms`}
                  </p>
                  <p className="break-all">ID da análise: {result.evidence.analysisId}</p>
                </div>
              )}
            </div>
          )}
          {result.status === 'unavailable' && (
            <p role="alert">A Laya não retornou uma análise: {TRIAGE_UNAVAILABLE_MESSAGES[result.reasonCode]}</p>
          )}
          {result.status === 'error' && <p role="alert">{result.message}</p>}
          {!validInput && title.trim() && (
            <p role="alert">O título deve ter até 500 caracteres e a descrição até 12.000.</p>
          )}
        </div>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {layaEnabled === false && (
          <Button size="sm" onClick={() => void create(flow)} disabled={!title.trim() || pending}>
            {pending ? 'Criando…' : 'Adicionar'}
          </Button>
        )}
        {layaEnabled && (
          <>
            {result.status === 'suggested' ? (
              <Button size="sm" onClick={() => void create(result.suggestedFlow, true)} disabled={pending}>
                {pending ? 'Criando…' : `Criar card como ${FLOW_LABELS[result.suggestedFlow]}`}
              </Button>
            ) : (
              <Button size="sm" onClick={analyze} disabled={!validInput || pending || result.status === 'loading'}>
                {result.status === 'loading'
                  ? 'Analisando…'
                  : hasResponse || result.status === 'unavailable' || result.status === 'error'
                    ? 'Tentar análise novamente'
                    : 'Analisar com Laya'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void create('dificil')}
              disabled={!title.trim() || pending}
            >
              Criar sem sugestão (Difícil)
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={close} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}

export function NewCard({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" className="min-h-8 justify-start text-muted-foreground" onClick={onClick}>
      <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-4" />
      Adicionar card
    </Button>
  )
}

export function NewCardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo card</DialogTitle>
          <DialogDescription>Crie o trabalho na entrada do pipeline. A etapa inicial será “A fazer”.</DialogDescription>
        </DialogHeader>
        <CardForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
