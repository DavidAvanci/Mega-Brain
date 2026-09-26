import { Button } from '@/components/ui/button'
import type { Repository, RepositoryStatus } from '../../../shared/domain/repositories'
import { repositoryPrimaryAction } from './repository-view-model'

export function RepositoryGitActions({
  repository,
  status,
  busy,
  onVerify,
  onPull,
  onSettings,
}: {
  repository: Repository
  status?: RepositoryStatus
  busy: boolean
  onVerify: (id: string) => void
  onPull: (id: string) => void
  onSettings: (id: string) => void
}) {
  const action = repositoryPrimaryAction(status)
  if (!action) return null
  if (action === 'settings')
    return (
      <Button type="button" size="sm" onClick={() => onSettings(repository.id)}>
        Abrir configurações
      </Button>
    )
  return (
    <Button
      type="button"
      size="sm"
      disabled={busy}
      onClick={() => (action === 'pull' ? onPull(repository.id) : onVerify(repository.id))}
    >
      {busy
        ? 'Aguarde…'
        : action === 'pull'
          ? 'Atualizar checkout'
          : status?.state === 'remote-failed'
            ? 'Tentar verificar remoto'
            : 'Verificar remoto'}
    </Button>
  )
}
