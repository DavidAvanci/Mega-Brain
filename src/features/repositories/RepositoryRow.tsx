import { memo, useState } from 'react'
import {
  Download01Icon,
  FolderOpenIcon,
  GitBranchIcon,
  Refresh01Icon,
  Settings02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Button } from '@/components/ui/button'
import type {
  Repository,
  RepositoryEnvironmentKey,
  RepositoryMigrationResult,
  RepositoryStatus,
} from '../../../shared/domain/repositories'
import { repositoryPrimaryAction, repositoryStatusLabel } from './repository-view-model'

const environmentKeys: RepositoryEnvironmentKey[] = ['local', 'staging', 'prod']
const labels: Record<RepositoryEnvironmentKey, string> = { local: 'Local', staging: 'Staging', prod: 'Prod' }

export const RepositoryRow = memo(function RepositoryRow({
  repository,
  status,
  migration,
  operation,
  onVerify,
  onPull,
  onResolveDirty,
  onSwitchMaster,
  onMigrate,
  onToggleActive,
  onSettings,
  onOpenEditor,
}: {
  repository: Repository
  status?: RepositoryStatus
  migration?: RepositoryMigrationResult
  operation?: string
  onVerify: (id: string) => void
  onPull: (id: string) => void
  onResolveDirty: (id: string) => void
  onSwitchMaster: (id: string) => void
  onMigrate: (id: string, environment: RepositoryEnvironmentKey) => void
  onToggleActive: (id: string) => void
  onSettings: (id: string) => void
  onOpenEditor: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const state = repositoryStatusLabel(status)
  const error = status?.state === 'remote-failed' || (!status?.available && !!status)
  const attention = !!status && (status.dirty || ['behind', 'ahead', 'diverged', 'no-upstream'].includes(status.state))
  const primaryAction = status?.dirty ? null : repositoryPrimaryAction(status)
  const resolveDirty = status?.dirty && status.state === 'behind' && status.source === 'local'
  const configuredMigrations = environmentKeys.filter((key) => repository.environments[key]?.migration?.backend)
  const syncTone = error ? 'error' : attention ? 'attention' : status?.source === 'remote' ? 'success' : 'pending'
  const syncLabel =
    status?.state === 'behind' && status.source === 'remote'
      ? `${status.behind ?? 0} atrás`
      : status?.state === 'diverged'
        ? `${status.ahead ?? 0} à frente · ${status.behind ?? 0} atrás`
        : status?.state === 'ahead'
          ? `${status.ahead ?? 0} à frente`
          : state

  return (
    <article
      className={`repo-row ${repository.active ? '' : 'is-inactive'}`}
      aria-label={`Repositório ${repository.displayName}`}
    >
      <div className="repo-identity">
        <label className="repo-toggle-wrap" title={repository.active ? 'Desativar repositório' : 'Ativar repositório'}>
          <input
            type="checkbox"
            role="switch"
            checked={repository.active}
            onChange={() => onToggleActive(repository.id)}
            aria-label={`${repository.active ? 'Desativar' : 'Ativar'} ${repository.displayName}`}
          />
          <span className="repo-toggle" aria-hidden="true" />
        </label>
        <div className="repo-identity-copy">
          <div className="repo-name-line">
            <h3 title={repository.displayName}>{repository.displayName}</h3>
          </div>
          <p title={repository.path}>{repository.path}</p>
        </div>
      </div>

      <div className="repo-branch-cell">
        <div className="repo-branch-name">
          <HugeiconsIcon icon={GitBranchIcon} strokeWidth={1.8} />
          <span title={status?.branch}>
            {status?.available ? status.branch || 'detached' : status ? 'indisponível' : 'carregando…'}
          </span>
        </div>
        {status?.dirty && <span className="repo-dirty-label">● Alterações locais</span>}
      </div>

      <div className={`repo-sync-cell tone-${syncTone}`}>
        <div className="repo-sync-label">
          <span className="repo-sync-dot" aria-hidden="true" />
          {resolveDirty ? (
            <Button type="button" size="sm" variant="outline" disabled={!!operation} onClick={() => onResolveDirty(repository.id)}>
              Resolver alterações
            </Button>
          ) : syncLabel}
        </div>
        {status?.dirty && !resolveDirty && (
          <p className="repo-sync-blocked">
            Salve, guarde ou descarte as alterações locais antes de sincronizar.
          </p>
        )}
        {primaryAction === 'pull' && (
          <Button
            type="button"
            size="sm"
            className="repo-row-action"
            disabled={!!operation || !!status?.dirty}
            onClick={() => onPull(repository.id)}
          >
            <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
            {operation === 'pull' ? 'Atualizando…' : 'Atualizar'}
          </Button>
        )}
        {primaryAction === 'verify' && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="repo-row-action repo-row-action-verify"
            disabled={!!operation}
            onClick={() => onVerify(repository.id)}
          >
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} />
            {operation === 'verify' ? 'Verificando…' : 'Verificar'}
          </Button>
        )}
      </div>

      <div className="repo-row-controls">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Abrir ${repository.displayName} no editor configurado`}
          title="Abrir no editor"
          disabled={!!operation}
          onClick={() => onOpenEditor(repository.id)}
        >
          <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={1.8} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Configurações de ${repository.displayName}`}
          title="Configurações"
          onClick={() => onSettings(repository.id)}
        >
          <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.8} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-expanded={expanded}
          aria-controls={`repository-details-${repository.id}`}
          aria-label={`${expanded ? 'Ocultar' : 'Ver'} detalhes de ${repository.displayName}`}
          title="Detalhes"
          onClick={() => setExpanded((value) => !value)}
        >
          <svg
            className={`repo-chevron-icon ${expanded ? 'is-expanded' : ''}`}
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
          >
            <path
              d="m5 7.5 5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
      </div>

      {expanded && (
        <div id={`repository-details-${repository.id}`} className="repo-details">
          <dl>
            <dt>Caminho</dt>
            <dd title={repository.path}>{repository.path}</dd>
            <dt>Origin</dt>
            <dd title={status?.origin}>{status?.origin ?? repository.githubUrl ?? 'não configurado'}</dd>
            <dt>Upstream</dt>
            <dd>{status?.upstream ?? 'não configurado'}</dd>
            <dt>Verificado</dt>
            <dd>
              {status?.remoteCheckedAt
                ? new Date(status.remoteCheckedAt).toLocaleString()
                : 'remoto ainda não verificado'}
            </dd>
            <dt>Status</dt>
            <dd>
              {repository.active ? 'Ativo' : 'Inativo'} ·{' '}
              {status?.available
                ? status.dirty
                  ? 'com alterações locais'
                  : 'checkout limpo'
                : 'checkout indisponível'}
            </dd>
            {status?.error && (
              <>
                <dt>Erro</dt>
                <dd className="repo-detail-error" role="alert">
                  {status.error}
                </dd>
              </>
            )}
          </dl>
          {status?.available && status.branch !== 'master' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!!operation}
              onClick={() => onSwitchMaster(repository.id)}
            >
              Ir para master
            </Button>
          )}
          {configuredMigrations.map((key) => {
            const config = repository.environments[key].migration!
            return (
              <div key={key} className="repo-migration-action">
                <span>
                  Migração {labels[key]} ·{' '}
                  <code>
                    {config.command.join(' ')} · {config.workingDirectory}
                  </code>
                </span>
                {status?.migrationReady && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!!operation}
                    onClick={() => onMigrate(repository.id, key)}
                  >
                    Executar {labels[key]}
                  </Button>
                )}
              </div>
            )
          })}
          {migration && migration.state !== 'idle' && (
            <p className="repo-migration-result" role="status">
              Migração {migration.environment ? labels[migration.environment] : ''}:{' '}
              {migration.state === 'success' ? 'sucesso' : migration.state === 'failure' ? 'falha' : 'executando'}{' '}
              {migration.error ?? migration.output ?? ''}
            </p>
          )}
        </div>
      )}
    </article>
  )
})
