import { useId, useRef, type RefObject } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SettingsSearchEntry, SettingsTab } from './settings-search'

type Category = { value: SettingsTab; label: string }

export function SettingsSearchInput({
  inputRef,
  query,
  onChange,
  onSelectFirst,
  onFocusResults,
  disabled,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  onChange: (query: string) => void
  onSelectFirst: () => void
  onFocusResults: () => void
  disabled: boolean
}) {
  return (
    <div className="relative shrink-0">
      <HugeiconsIcon
        icon={Search01Icon}
        strokeWidth={1.5}
        className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Buscar configurações"
        placeholder="Buscar…"
        className="h-8 ps-8 pe-8 text-xs md:text-xs [&::-webkit-search-cancel-button]:appearance-none"
        value={query}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (!query.trim() || event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            onSelectFirst()
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            onFocusResults()
          }
        }}
      />
      {query && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute end-1 top-1/2 -translate-y-1/2"
          aria-label="Limpar busca"
          title="Limpar busca"
          disabled={disabled}
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.5} />
        </Button>
      )}
    </div>
  )
}

export function SettingsSearchResults({
  results,
  categories,
  onSelect,
  inputRef,
  containerRef,
  disabled,
}: {
  results: SettingsSearchEntry[]
  categories: readonly Category[]
  onSelect: (entry: SettingsSearchEntry) => void
  inputRef: RefObject<HTMLInputElement | null>
  containerRef: RefObject<HTMLDivElement | null>
  disabled: boolean
}) {
  const titleId = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div ref={containerRef} role="region" aria-labelledby={titleId} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1 px-2">
        <h3 id={titleId} className="text-xs font-medium">
          Resultados
        </h3>
        <p role="status" className="text-[10px] text-muted-foreground">
          {results.length} {results.length === 1 ? 'resultado' : 'resultados'}
        </p>
      </div>
      {results.length ? (
        <ul className="grid gap-1">
          {results.map((entry, index) => (
            <li key={entry.target}>
              <Button
                ref={(button) => {
                  buttons.current[index] = button
                }}
                type="button"
                variant="ghost"
                className="h-auto w-full justify-start gap-2 rounded-lg px-2 py-2 text-start whitespace-normal"
                title={entry.description}
                disabled={disabled}
                onClick={() => onSelect(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    buttons.current[(index + 1) % results.length]?.focus()
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    if (index === 0) inputRef.current?.focus()
                    else buttons.current[index - 1]?.focus()
                  }
                }}
              >
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {categories.find((category) => category.value === entry.tab)?.label}
                  </span>
                  <span className="text-xs font-semibold">{entry.title}</span>
                  <span className="sr-only">{entry.description}</span>
                </span>
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.5} className="size-4 text-muted-foreground" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid justify-items-center gap-2 px-2 py-6 text-center">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={1.5} className="mb-1 size-6 text-muted-foreground" />
          <p className="text-xs font-medium">Nenhuma configuração encontrada</p>
          <p className="text-[11px] text-muted-foreground">Tente Jira, modelo ou terminal.</p>
        </div>
      )}
    </div>
  )
}
