import { KnowledgeAttachments } from '@/features/knowledge/KnowledgeAttachments'
import type { KnowledgeRef } from '../../../../shared/domain/knowledge'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RepositoryMentionTextarea } from '@/components/RepositoryMentionTextarea'
import { createCard } from '../model/card-commands'
import { TEST_CARD } from '../model/test-card'
import { fetchMegaBrainSettings } from '../api/card-detail-api'
import { useCardTriage } from '../model/useCardTriage'
import { TRIAGE_UNAVAILABLE_MESSAGES } from '../../../../shared/domain/card-triage'
import { FLOW_DESCRIPTIONS, FLOW_LABELS, FLOW_LEVELS, type FlowLevel } from '../../../../shared/domain/cards'

function CardForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [knowledgeRefs, setKnowledgeRefs] = useState<KnowledgeRef[]>([])
  const [flow, setFlow] = useState<FlowLevel>('dificil')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jevEnabled, setJevEnabled] = useState<boolean | null>(null)
  const createdAnalysis = useRef<string | null>(null)
  const triage = useCardTriage()
  useEffect(() => {
    let mounted = true
    void fetchMegaBrainSettings()
      .then((settings) => {
        if (mounted) setJevEnabled(settings.general.jevEnabled === true)
      })
      .catch(() => {
        if (mounted) {
          setJevEnabled(false)
          setError('Não foi possível carregar as configurações. Você pode criar o card escolhendo o fluxo manualmente.')
        }
      })
    return () => {
      mounted = false
    }
  }, [])

  const edit = (field: 'title' | 'description', value: string) => {
    triage.invalidate()
    createdAnalysis.current = null
    setError(null)
    if (field === 'title') setTitle(value)
    else setDescription(value)
  }

  const close = () => {
    triage.invalidate()
    createdAnalysis.current = null
    setTitle('')
    setDescription('')
    setFlow('dificil')
    setError(null)
    onDone()
  }

  const create = async (selectedFlow: FlowLevel, usedSuggestion = false, input = { title, description }) => {
    const trimmed = input.title.trim()
    if (!trimmed || pending) return
    setPending(true)
    setError(null)
    try {
      await createCard(trimmed, input.description, selectedFlow, knowledgeRefs)
      if (jevEnabled) {
        const suggestion = usedSuggestion && triage.state.status === 'suggested' ? triage.state : undefined
        const evidence = suggestion?.evidence
        const confidence = suggestion
          ? (suggestion.probabilities[selectedFlow] * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
          : undefined
        toast.success(`Card criado com dificuldade ${FLOW_LABELS[selectedFlow]}`, {
          description: suggestion
            ? `${confidence}% confiança • ${evidence ? Math.round(evidence.durationMs) : '—'}ms`
            : undefined,
        })
      }
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    if (jevEnabled !== true || triage.state.status !== 'suggested' || pending) return
    const analysisId = triage.state.evidence?.analysisId ?? `${title.trim()}\0${description}`
    if (createdAnalysis.current === analysisId) return
    createdAnalysis.current = analysisId
    void create(triage.state.suggestedFlow, true)
  }, [description, jevEnabled, pending, title, triage.state])

  const createTestCard = () => {
    if (pending || triage.state.status === 'loading') return
    triage.invalidate()
    createdAnalysis.current = null
    void create('dificil', false, TEST_CARD)
  }

  const analyze = () => {
    if (!title.trim() || title.trim().length > 500 || description.length > 12000 || pending) return
    setError(null)
    void triage.suggest(title.trim(), description)
  }

  const primaryAction = () => {
    if (jevEnabled) {
      if (triage.state.status !== 'suggested') analyze()
    } else if (jevEnabled === false) void create(flow)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      primaryAction()
    } else if (e.key === 'Escape') close()
  }
  const validInput = Boolean(title.trim()) && title.trim().length <= 500 && description.length <= 12000
  const result = triage.state

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
      <KnowledgeAttachments value={knowledgeRefs} onChange={setKnowledgeRefs} disabled={pending} />
      <RepositoryMentionTextarea
        aria-label="Descrição do card"
        disabled={pending}
        placeholder="Descrição"
        value={description}
        rows={4}
        className="resize-none bg-card"
        onValueChange={(value) => edit('description', value)}
        onKeyDown={onKeyDown}
      />
      {jevEnabled === false && (
        <fieldset className="grid gap-1 text-xs font-medium text-muted-foreground">
          <legend className="mb-1">Nível do fluxo</legend>
          <div className="grid grid-cols-3 gap-1 rounded-lg border bg-muted p-1">
            {FLOW_LEVELS.map((level) => (
              <label key={level} className="cursor-pointer">
                <input
                  type="radio"
                  name="card-flow"
                  value={level}
                  checked={flow === level}
                  disabled={pending}
                  onChange={() => setFlow(level)}
                  className="peer sr-only"
                />
                <span className="flex h-7 items-center justify-center rounded-md px-2 text-xs transition-colors peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                  {FLOW_LABELS[level]}
                </span>
              </label>
            ))}
          </div>
          <span className="font-normal">{FLOW_DESCRIPTIONS[flow]}</span>
        </fieldset>
      )}
      {jevEnabled && (
        <div className="grid gap-2 text-xs" aria-live="polite">
          {result.status === 'loading' && <p role="status">Consultando o Jev…</p>}
          {result.status === 'unavailable' && (
            <p role="alert">O Jev não retornou uma análise: {TRIAGE_UNAVAILABLE_MESSAGES[result.reasonCode]}</p>
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
        
     
        {jevEnabled !== true && (
          <>
           <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-xs text-muted-foreground"
          title="Criar uma cópia do MB-069 com dificuldade Difícil"
          onClick={createTestCard}
          disabled={pending || result.status === 'loading'}
        >
          Criar card teste
        </Button>
          <Button
            size="sm"
            onClick={() => void create(flow)}
            disabled={jevEnabled === null || !title.trim() || pending}
          >
            {jevEnabled === null ? 'Carregando…' : pending ? 'Criando…' : 'Adicionar'}
          </Button>
          
          </>
        )}
        {jevEnabled && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void create('dificil')}
              disabled={!title.trim() || pending}
            >
              Criar (Difícil)
            </Button>
            <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-xs text-muted-foreground"
          title="Criar uma cópia do MB-069 com dificuldade Difícil"
          onClick={createTestCard}
          disabled={pending || result.status === 'loading'}
        >
          Criar card teste
        </Button>
            {result.status !== 'suggested' && (
              <Button size="sm" onClick={analyze} disabled={!validInput || pending || result.status === 'loading'}>
                {result.status === 'loading'
                  ? 'Criando…'
                  : result.status === 'unavailable' || result.status === 'error'
                    ? 'Tentar análise novamente'
                    : 'Criar com Jev'}
              </Button>
            )}
          </>
        )}
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
        </DialogHeader>
        <CardForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
