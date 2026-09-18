import type { BoardStateFilter } from './boardPreferences'
import type { Card } from './types'

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000

export function attentionReason(card: Card, now = Date.now()): string | null {
  if (card.agents?.some((agent) => agent.status === 'erro')) return 'Agente com erro'
  if (card.devEnv?.status === 'erro') return 'Ambiente de desenvolvimento com erro'
  if (card.agents?.some((agent) => agent.status === 'aguardando')) return 'Agente aguardando uma ação'
  if (card.status === 'code-review' && Object.values(card.prStates ?? {}).some((state) => state === 'open')) return 'PR aguardando revisão'
  if (card.agents?.some((agent) => agent.status === 'rodando')) return null
  const lastChange = new Date(card.updatedAt ?? card.createdAt).getTime()
  const olderThanTwoDays = Number.isFinite(lastChange) && now - lastChange > TWO_DAYS_MS
  const activeAndOld = olderThanTwoDays && !['a-fazer', 'producao'].includes(card.status)
  return activeAndOld ? 'Card ativo sem atualização há mais de dois dias' : null
}

export function needsAttention(card: Card, now = Date.now()): boolean {
  return attentionReason(card, now) !== null
}

export function matchesQuery(card: Card, query: string): boolean {
  if (!query) return true
  const searchable = [card.id, card.title, card.description, card.folder, card.jiraStatus]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('pt-BR')
  return searchable.includes(query.toLocaleLowerCase('pt-BR'))
}

export function matchesState(card: Card, state: BoardStateFilter): boolean {
  if (state === 'all') return true
  if (state === 'pr') return Boolean(card.prs)
  if (state === 'error') return card.devEnv?.status === 'erro' || Boolean(card.agents?.some((agent) => agent.status === 'erro'))
  if (state === 'waiting') return Boolean(card.agents?.some((agent) => agent.status === 'aguardando'))
  return Boolean(card.agents?.some((agent) => agent.status === 'rodando'))
}
