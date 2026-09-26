import type { RepositoryStatus } from '../../../shared/domain/repositories'

export type RepositoryFilter = 'all' | 'attention' | 'behind' | 'unverified' | 'unavailable'

export function repositoryNeedsAttention(status?: RepositoryStatus): boolean {
  return (
    !!status &&
    (!!status.dirty ||
      status.state === 'behind' ||
      status.state === 'ahead' ||
      status.state === 'diverged' ||
      status.state === 'no-upstream' ||
      status.state === 'remote-failed' ||
      status.state === 'unavailable')
  )
}

export function matchesRepositoryFilter(status: RepositoryStatus | undefined, filter: RepositoryFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'attention') return repositoryNeedsAttention(status)
  if (filter === 'behind') return status?.state === 'behind'
  if (filter === 'unavailable') return status?.state === 'unavailable' || status?.available === false
  return !!status && status.available && status.source === 'local' && status.state !== 'no-upstream'
}

export function repositoryStatusLabel(status?: RepositoryStatus): string {
  if (!status) return 'Carregando status'
  if (status.state === 'remote-failed') return 'Erro ao verificar remoto'
  if (!status.available || status.state === 'unavailable') return 'Checkout indisponível'
  if (status.state === 'no-upstream') return 'Sem upstream'
  if (status.state === 'diverged') return 'Divergente'
  if (status.state === 'ahead') return 'À frente'
  if (status.state === 'behind') return status.source === 'remote' ? 'Atrás do remoto' : 'Atrás (dados locais)'
  return status.source === 'remote' ? 'Atualizado' : 'Remoto não verificado'
}

export function repositoryPrimaryAction(status?: RepositoryStatus): 'verify' | 'pull' | 'settings' | null {
  if (!status) return null
  if (status.state === 'remote-failed') return 'verify'
  if (!status.available || status.state === 'unavailable') return 'settings'
  if (status.state === 'no-upstream') return 'settings'
  if (status.state === 'behind' && status.source === 'remote' && !status.dirty) return 'pull'
  if (
    (status.state === 'behind' && status.source === 'local') ||
    (status.state === 'up-to-date' && status.source === 'local') ||
    (status.state === 'ahead' && status.source === 'local') ||
    (status.state === 'diverged' && status.source === 'local')
  )
    return 'verify'
  return null
}
