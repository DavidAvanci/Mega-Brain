import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { BookOpen01Icon, Cancel01Icon, File01Icon, Folder01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tip } from '@/Tip'
import type { KnowledgeRef, KnowledgeSearchResult } from '../../../shared/domain/knowledge'
import { knowledgeApi } from './api'
export function KnowledgeAttachments({
  value,
  onChange,
  onMention,
  disabled = false,
}: {
  value: KnowledgeRef[]
  onChange: (refs: KnowledgeRef[]) => void
  onMention?: (text: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<KnowledgeSearchResult[]>([])
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      void knowledgeApi
        .search(query)
        .then((result) => {
          if (!active) return
          setItems(result)
          setLabels((previous) => ({ ...previous, ...Object.fromEntries(result.map((item) => [item.id, item.title])) }))
          setError('')
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : 'Falha ao pesquisar notas')
        })
    }, 150)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query, open])
  const choose = (item: KnowledgeSearchResult) => {
    if (!value.some((ref) => ref.id === item.id && ref.kind === item.kind))
      onChange([...value, { kind: item.kind, id: item.id }])
    onMention?.(`@nota[${item.kind}:${item.id}]`)
    setOpen(false)
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tip label={onMention ? 'Mencionar página ou pasta' : 'Anexar conhecimento'}>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className={onMention ? 'size-10' : undefined}
          aria-label={onMention ? 'Mencionar página ou pasta' : 'Anexar conhecimento'}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <HugeiconsIcon icon={BookOpen01Icon} size={16} />
        </Button>
      </Tip>
      {value.map((ref) => (
        <span
          key={`${ref.kind}:${ref.id}`}
          className="flex max-w-52 items-center gap-1 rounded-md border bg-muted/30 py-0.5 pl-2 text-[11px]"
        >
          <HugeiconsIcon icon={ref.kind === 'folder' ? Folder01Icon : File01Icon} size={12} />
          <span className="truncate">{labels[ref.id] ?? 'Referência anexada'}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remover ${labels[ref.id] ?? 'referência'}`}
            disabled={disabled}
            onClick={() => onChange(value.filter((item) => item.id !== ref.id || item.kind !== ref.kind))}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </Button>
        </span>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{onMention ? 'Mencionar conhecimento' : 'Anexar conhecimento à tarefa'}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="Pesquisar notas para anexar"
            placeholder="Buscar páginas ou pastas…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="max-h-80 overflow-auto">
            {error && (
              <p role="alert" className="p-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {items.map((item) => (
              <button
                type="button"
                key={`${item.kind}:${item.id}`}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
                onClick={() => choose(item)}
              >
                <HugeiconsIcon icon={item.kind === 'folder' ? Folder01Icon : File01Icon} size={16} />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.breadcrumbs.join(' / ') || 'Raiz do conhecimento'}
                  </span>
                </span>
              </button>
            ))}
            {!error && !items.length && (
              <p className="p-3 text-xs text-muted-foreground">
                Nenhuma página ou pasta encontrada. Crie suas primeiras notas em Conhecimento.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
