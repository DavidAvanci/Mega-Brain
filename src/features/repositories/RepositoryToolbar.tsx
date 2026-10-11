import { Input } from '@/components/ui/input'
import { AppSelect } from '@/components/ui/select'
import type { RepositoryFilter } from './repository-view-model'

export type RepositoryScope = 'all' | 'attention' | 'active' | 'inactive'

const filters: { value: RepositoryFilter; label: string }[] = [
  { value: 'all', label: 'Todos os estados' },
  { value: 'attention', label: 'Com alterações ou divergência' },
  { value: 'behind', label: 'Atrás do remoto' },
  { value: 'unverified', label: 'Não verificados' },
  { value: 'unavailable', label: 'Indisponíveis' },
]

export function RepositoryToolbar({
  query,
  filter,
  scope,
  count,
  total,
  attentionCount,
  activeCount,
  inactiveCount,
  onQueryChange,
  onFilterChange,
  onScopeChange,
}: {
  query: string
  filter: RepositoryFilter
  scope: RepositoryScope
  count: number
  total: number
  attentionCount: number
  activeCount: number
  inactiveCount: number
  onQueryChange: (value: string) => void
  onFilterChange: (value: RepositoryFilter) => void
  onScopeChange: (value: RepositoryScope) => void
}) {
  const scopes: { value: RepositoryScope; label: string; count: number }[] = [
    { value: 'all', label: 'Todos', count: total },
    { value: 'attention', label: 'Atenção', count: attentionCount },
    { value: 'active', label: 'Ativos', count: activeCount },
    { value: 'inactive', label: 'Inativos', count: inactiveCount },
  ]

  return (
    <div className="repo-toolbar">
      <label className="repo-search">
        <span className="sr-only">Buscar repositórios</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <circle cx="10.8" cy="10.8" r="6.3" stroke="currentColor" strokeWidth="1.7" />
          <path d="m15.5 15.5 4.2 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <Input
          aria-label="Buscar repositórios"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar por nome, alias ou caminho"
        />
      </label>
      <div className="repo-toolbar-controls">
        <nav className="repo-scope-tabs" aria-label="Filtrar catálogo">
          {scopes.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={scope === item.value}
              className={scope === item.value ? 'is-selected' : ''}
              onClick={() => onScopeChange(item.value)}
            >
              {item.label}
              <span>{item.count}</span>
            </button>
          ))}
        </nav>
        <div className="repo-state-filter">
          <AppSelect<RepositoryFilter>
            ariaLabel="Filtrar repositórios por estado"
            value={filter}
            onValueChange={onFilterChange}
            options={filters}
            className="repo-select-trigger"
          />
        </div>
      </div>
      <p className="repo-result-count" role="status">
        {count} de {total} {total === 1 ? 'repositório' : 'repositórios'}
      </p>
    </div>
  )
}
