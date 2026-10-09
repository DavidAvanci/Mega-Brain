import { useEffect, useState } from 'react'
import type { Card } from '../../../shared/domain/cards'
import { KnowledgeAttachments } from './KnowledgeAttachments'
import { updateWorkspaceCard } from '@/features/cards/api/cards-api'
import { refresh } from '@/features/cards/model/card-commands'
export function CardKnowledgeAttachments({ card }: { card: Card }) {
  const [refs, setRefs] = useState(card.knowledgeRefs ?? [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setRefs(card.knowledgeRefs ?? [])
  }, [card.id, card.knowledgeRefs])
  return (
    <section className="mt-5 border-t pt-4" aria-label="Conhecimento anexado">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Conhecimento para os agentes</p>
      <KnowledgeAttachments
        value={refs}
        disabled={pending}
        onChange={(next) => {
          setPending(true)
          setError('')
          void updateWorkspaceCard(card.id, { knowledgeRefs: next })
            .then(() => {
              setRefs(next)
              return refresh()
            })
            .catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao anexar conhecimento'))
            .finally(() => setPending(false))
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
