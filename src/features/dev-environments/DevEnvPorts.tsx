import { HugeiconsIcon } from '@hugeicons/react'
import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DevEnvApp, DevEnvAppStatus } from '../../../shared/domain/agents'
import type { DevEnvProjectPreview } from '../../../shared/domain/dev-environments'

const STATUS: Record<DevEnvAppStatus, string> = {
  aguardando: 'Aguardando',
  instalando: 'Instalando',
  subindo: 'Iniciando',
  rodando: 'Rodando',
  erro: 'Falhou',
  parado: 'Parado',
}
type PlannedPort = Pick<DevEnvProjectPreview, 'repo' | 'port' | 'selected' | 'services'>

export function DevEnvPorts({
  apps,
  projects,
  onOpen,
}: {
  apps: DevEnvApp[]
  projects?: PlannedPort[]
  onOpen: (repo: string) => void
}) {
  const selected =
    projects
      ?.filter((project) => project.selected)
      .flatMap((project) => [
        project,
        ...(project.services ?? [])
          .filter((service) => service.name !== 'external-api')
          .map((service) => ({
            repo: `${project.repo}/${service.name}`,
            port: service.port,
            selected: true,
          })),
      ]) ?? apps.map((app) => ({ repo: app.repo, port: app.port, selected: true }))
  const repositories = [
    ...new Set([
      ...selected.map((project) => project.repo),
      ...apps
        .filter((app) => ['rodando', 'subindo', 'instalando', 'aguardando', 'erro'].includes(app.status))
        .map((app) => app.repo),
    ]),
  ]
  const running = apps.filter((app) => app.status === 'rodando').length
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border" aria-label="Portas do ambiente">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
        <h3 className="text-sm font-medium">Portas do ambiente</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {running} em execução · {selected.length} {selected.length === 1 ? 'prevista' : 'previstas'}
        </span>
      </div>
      {repositories.length ? (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-left text-xs" aria-label="Portas previstas e em execução">
            <thead className="sticky top-0 bg-background text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Projeto</th>
                <th className="px-3 py-2 font-medium">Prevista</th>
                <th className="px-3 py-2 font-medium">Em execução</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="w-12">
                  <span className="sr-only">Abrir projeto</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {repositories.map((repo) => {
                const planned = selected.find((project) => project.repo === repo)
                const app = apps.find((project) => project.repo === repo)
                const live = app?.status === 'rodando'
                return (
                  <tr key={repo}>
                    <th scope="row" className="max-w-64 px-4 py-2 font-medium break-words">
                      {repo}
                      {app?.note && <p className="mt-1 text-[11px] font-normal text-muted-foreground">{app.note}</p>}
                    </th>
                    <td className="px-3 py-2 font-mono tabular-nums">{planned?.port ?? '—'}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{live ? (app.port ?? '—') : '—'}</td>
                    <td
                      className={cn(
                        'px-3 py-2 whitespace-nowrap',
                        app?.status === 'erro' ? 'text-destructive' : live ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {app ? STATUS[app.status] : 'Previsto'}
                    </td>
                    <td className="pr-2">
                      {live && app.url && (
                        <Button
                          variant="ghost"
                          aria-label={`Abrir ${repo} na porta ${app.port}`}
                          title={app.url}
                          className="size-10"
                          onClick={() => onOpen(repo)}
                        >
                          <HugeiconsIcon icon={LinkSquare02Icon} className="size-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Nenhuma porta prevista. Selecione projetos em Configurar ambiente.
        </p>
      )}
    </section>
  )
}
