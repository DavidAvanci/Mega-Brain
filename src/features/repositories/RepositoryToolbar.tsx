import { Input } from '@/components/ui/input'
import type { RepositoryFilter } from './repository-view-model'

const filters: { value: RepositoryFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'attention', label: 'Precisam de atenção' },
  { value: 'behind', label: 'Atrás' },
  { value: 'unverified', label: 'Não verificados' },
  { value: 'unavailable', label: 'Indisponíveis' },
]

export function RepositoryToolbar({
  query,
  filter,
  count,
  total,
  onQueryChange,
  onFilterChange,
}: {
  query: string
  filter: RepositoryFilter
  count: number
  total: number
  onQueryChange: (value: string) => void
  onFilterChange: (value: RepositoryFilter) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <Input
        aria-label="Buscar repositórios"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Buscar por nome, alias ou caminho"
        className="bg-background"
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Estado
        <select
          aria-label="Filtrar repositórios por estado"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value as RepositoryFilter)}
          className="h-8 min-w-0 rounded-lg border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {filters.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2" role="status">
        {count} de {total} {total === 1 ? 'repositório' : 'repositórios'}
      </p>
    </div>
  )
}
