import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  FilterIcon,
  GridViewIcon,
  ListViewIcon,
  PlusSignIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { BoardPreferences } from './boardPreferences'
import { JiraSync } from './JiraSync'

interface Props {
  query: string
  onQueryChange: (query: string) => void
  preferences: BoardPreferences
  onPreferencesChange: (patch: Partial<BoardPreferences>) => void
  visibleCount: number
  totalCount: number
  onNewCard: () => void
}

export function BoardToolbar({
  query,
  onQueryChange,
  preferences,
  onPreferencesChange,
  visibleCount,
  totalCount,
  onNewCard,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditing = target?.matches('input, textarea, select, [contenteditable="true"]')
      if ((event.key === '/' && !isEditing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const activeFilterCount = Number(preferences.attentionOnly) + Number(preferences.flow !== 'all') + Number(preferences.state !== 'all')

  return (
    <section className="border-b bg-card" aria-label="Controles do quadro">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 md:px-4">
        <div className="mr-2 min-w-32">
          <h2 className="text-sm font-semibold">Pipeline</h2>
          <p className="text-[11px] text-muted-foreground tabular-nums" aria-live="polite">
            {visibleCount === totalCount ? `${totalCount} cards` : `${visibleCount} de ${totalCount} cards`}
          </p>
        </div>
        <div className="relative order-last w-full sm:order-none sm:min-w-56 sm:max-w-md sm:flex-1">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar título, ID, repositório…"
            aria-label="Buscar cards"
            aria-keyshortcuts="/ Control+K Meta+K"
            className="h-8 bg-muted/40 pr-15 pl-8 font-sans text-sm"
          />
          {query ? (
            <Button variant="ghost" size="icon-xs" className="absolute top-1/2 right-1 -translate-y-1/2" aria-label="Limpar busca" onClick={() => onQueryChange('')}>
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            </Button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">/</kbd>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <JiraSync />
          <Button variant="outline" size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
            <HugeiconsIcon icon={FilterIcon} strokeWidth={2} />
            Filtros{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </Button>
          <div className="flex rounded-lg border bg-background p-0.5" aria-label="Visualização">
            <Button variant={preferences.view === 'board' ? 'secondary' : 'ghost'} size="icon-xs" aria-label="Visualização em quadro" aria-pressed={preferences.view === 'board'} onClick={() => onPreferencesChange({ view: 'board' })}>
              <HugeiconsIcon icon={GridViewIcon} strokeWidth={2} />
            </Button>
            <Button variant={preferences.view === 'list' ? 'secondary' : 'ghost'} size="icon-xs" aria-label="Visualização em lista" aria-pressed={preferences.view === 'list'} onClick={() => onPreferencesChange({ view: 'list' })}>
              <HugeiconsIcon icon={ListViewIcon} strokeWidth={2} />
            </Button>
          </div>
          <Button size="sm" onClick={onNewCard}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            Novo card
          </Button>
        </div>
      </div>

      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3 py-2 md:px-4" aria-label="Opções de exibição">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Fluxo
            <AppSelect value={preferences.flow} ariaLabel="Filtrar por fluxo" compact className="w-28" onValueChange={(flow) => onPreferencesChange({ flow })} options={[
              { value: 'all', label: 'Todos' }, { value: 'simples', label: 'Simples' }, { value: 'medio', label: 'Médio' }, { value: 'dificil', label: 'Difícil' },
            ]} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Estado
            <AppSelect value={preferences.state} ariaLabel="Filtrar por estado" compact className="w-36" onValueChange={(state) => onPreferencesChange({ state })} options={[
              { value: 'all', label: 'Todos' }, { value: 'running', label: 'Agente rodando' }, { value: 'waiting', label: 'Aguardando' }, { value: 'error', label: 'Com erro' }, { value: 'pr', label: 'Com PR' },
            ]} />
          </label>
          <FilterToggle pressed={preferences.attentionOnly} onClick={() => onPreferencesChange({ attentionOnly: !preferences.attentionOnly })}>Precisa de atenção</FilterToggle>
          {(preferences.attentionOnly || preferences.flow !== 'all' || preferences.state !== 'all') && (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onPreferencesChange({ attentionOnly: false, flow: 'all', state: 'all' })}>
              Limpar opções
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function FilterToggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant={pressed ? 'secondary' : 'outline'} size="xs" aria-pressed={pressed} onClick={onClick}>
      <span className={cn('size-1.5 rounded-full', pressed ? 'bg-primary' : 'bg-muted-foreground/40')} />
      {children}
    </Button>
  )
}
