import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AppSelect } from '@/components/ui/select'
import { createCard } from '../model/card-commands'
import { FLOW_DESCRIPTIONS, FLOW_LABELS, FLOW_LEVELS, type FlowLevel } from '../../../../shared/domain/cards'

function CardForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [flow, setFlow] = useState<FlowLevel>('dificil')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = title.trim()
    if (!trimmed || pending) return
    setPending(true)
    setError(null)
    try {
      await createCard(trimmed, description, flow)
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  const close = () => {
    setTitle('')
    setDescription('')
    setFlow('dificil')
    setError(null)
    onDone()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      close()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        autoFocus
        placeholder="Título"
        value={title}
        className="bg-card"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <Textarea
        placeholder="Descrição (vai pro card.json da pasta)"
        value={description}
        rows={4}
        className="resize-none bg-card"
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={onKeyDown}
      />
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
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={!title.trim() || pending}>
          {pending ? 'Criando…' : 'Adicionar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={close}>
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
