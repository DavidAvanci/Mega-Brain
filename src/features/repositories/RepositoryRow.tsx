import { memo, useState } from 'react'
import { Button } from '@/components/ui/button'
import type {
  Repository,
  RepositoryEnvironmentKey,
  RepositoryMigrationResult,
  RepositoryStatus,
} from '../../../shared/domain/repositories'
import { RepositoryGitActions } from './RepositoryGitActions'
import { repositoryStatusLabel } from './repository-view-model'

const environmentKeys: RepositoryEnvironmentKey[] = ['local', 'staging', 'prod']
const labels: Record<RepositoryEnvironmentKey, string> = { local: 'Local', staging: 'Staging', prod: 'Prod' }

export const RepositoryRow = memo(function RepositoryRow({
  repository,
  status,
  migration,
  operation,
  onVerify,
  onPull,
  onSwitchMaster,
  onMigrate,
  onToggleActive,
  onSettings,
}: {
  repository: Repository
  status?: RepositoryStatus
  migration?: RepositoryMigrationResult
  operation?: string
  onVerify: (id: string) => void
  onPull: (id: string) => void
  onSwitchMaster: (id: string) => void
  onMigrate: (id: string, environment: RepositoryEnvironmentKey) => void
  onToggleActive: (id: string) => void
  onSettings: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const state = repositoryStatusLabel(status)
  const error = status?.state === 'remote-failed' || (!status?.available && !!status)
  const warning =
    status?.state === 'behind' ||
    status?.state === 'ahead' ||
    status?.state === 'diverged' ||
    status?.state === 'no-upstream'
  const icon = !status ? '◌' : error ? '!' : warning ? '▲' : status.source === 'remote' ? '✓' : '◌'
  const configuredMigrations = environmentKeys.filter((key) => repository.environments[key]?.migration?.backend)

  return (
    <article
      className="min-w-0 rounded-lg border bg-card p-3 sm:p-4"
      aria-label={`Repositório ${repository.displayName}`}
    >
      <div className="flex flex-wrap items-start gap-3 sm:gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-base font-semibold">{repository.displayName}</h3>
            <code className="max-w-full break-all rounded bg-muted px-2 py-0.5 text-xs">{repository.alias}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded border px-2 py-0.5 font-medium">
              Branch: {status?.available ? status.branch || 'detached' : status ? 'indisponível' : 'carregando…'}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium ${error ? 'border-destructive/40 text-destructive' : warning ? 'border-amber-600/40 text-amber-700 dark:text-amber-300' : status?.source === 'remote' ? 'border-emerald-600/40 text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}
            >
              <span aria-hidden="true">{icon}</span>
              {state}
            </span>
            {status?.dirty && <span className="text-amber-700 dark:text-amber-300">● Alterações locais</span>}
            {status?.ahead !== undefined && (status.ahead > 0 || (status.behind ?? 0) > 0) && (
              <span className="text-muted-foreground">
                {status.ahead} à frente · {status.behind} atrás
              </span>
            )}
          </div>
        </div>
        <RepositoryGitActions
          repository={repository}
          status={status}
          busy={!!operation}
          onVerify={onVerify}
          onPull={onPull}
          onSettings={onSettings}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2"
        aria-expanded={expanded}
        aria-controls={`repository-details-${repository.id}`}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Ocultar detalhes' : 'Mais detalhes e ações'}
      </Button>
      {expanded && (
        <div id={`repository-details-${repository.id}`} className="mt-2 grid gap-3 border-t pt-3 text-xs">
          <div className="grid min-w-0 gap-1 text-muted-foreground">
            <p className="break-all">Caminho: {repository.path}</p>
            <p className="break-all">Origin: {status?.origin ?? repository.githubUrl ?? 'não configurado'}</p>
            <p>Upstream: {status?.upstream ?? 'não configurado'}</p>
            <p>
              {repository.active ? 'Ativo' : 'Inativo'} ·{' '}
              {status?.available
                ? status.dirty
                  ? 'Checkout com alterações locais'
                  : 'Checkout limpo'
                : 'Checkout indisponível'}
            </p>
            <p>
              {status?.source === 'remote'
                ? `Remoto verificado em ${status.remoteCheckedAt ? new Date(status.remoteCheckedAt).toLocaleString() : 'agora'}`
                : 'Dados locais; remoto ainda não verificado nesta ação'}
            </p>
            {status?.error && (
              <p className="text-destructive" role="alert">
                {status.error}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!!operation}
              onClick={() => onVerify(repository.id)}
            >
              Verificar remoto
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                !!operation ||
                !status?.available ||
                status.dirty ||
                status.state !== 'behind' ||
                status.source !== 'remote'
              }
              onClick={() => onPull(repository.id)}
            >
              Atualizar checkout
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onToggleActive(repository.id)}>
              {repository.active ? 'Desativar' : 'Ativar'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onSettings(repository.id)}>
              Configurações
            </Button>
          </div>
          {configuredMigrations.map((key) => {
            const config = repository.environments[key].migration!
            return (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <span>
                  Migração {labels[key]}: <code>{config.command.join(' ')}</code> em{' '}
                  <code>{config.workingDirectory}</code>
                </span>
                {status?.migrationReady && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!!operation}
                    onClick={() => onMigrate(repository.id, key)}
                  >
                    Executar migrações {labels[key]}
                  </Button>
                )}
              </div>
            )
          })}
          {migration && migration.state !== 'idle' && (
            <p role="status">
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
