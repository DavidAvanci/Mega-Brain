import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { DevEnvPreview, DevEnvStartOptions } from '../../../shared/domain/dev-environments'
import { startConfiguredDevEnv } from './dev-env-api'

type Props = {
  cardId: string
  preview: DevEnvPreview
  onClose: () => void
  onStartWithAgent?: (configuration: DevEnvStartOptions) => void
}

export function DevEnvConfiguration({ cardId, preview, onClose, onStartWithAgent }: Props) {
  const [projects, setProjects] = useState(
    preview.projects.map((project) => ({ ...project, port: String(project.port) })),
  )
  const [docker, setDocker] = useState(preview.docker)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = projects.filter((project) => project.selected)
  const invalidPort = selected.some(
    (project) => !/^\d+$/.test(project.port) || Number(project.port) < 1 || Number(project.port) > 65535,
  )
  const duplicatePort = new Set(selected.map((project) => Number(project.port))).size !== selected.length
  const dockerNeeded = selected.some((project) => ['api-garcom-digital', 'api-clube'].includes(project.repo))
  const validation = invalidPort
    ? 'Use portas inteiras entre 1 e 65535.'
    : duplicatePort
      ? 'Use uma porta diferente para cada projeto selecionado.'
      : null

  const start = async () => {
    if (pending || !selected.length || validation) return
    const configuration: DevEnvStartOptions = {
      projects: selected.map((project) => ({ repo: project.repo, port: Number(project.port) })),
      docker: dockerNeeded && docker,
    }
    setPending(true)
    setError(null)
    try {
      await startConfiguredDevEnv(cardId, configuration)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] flex-col sm:max-w-2xl [&_[data-slot=dialog-close]]:size-10"
        showCloseButton={!pending}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Configurar ambiente dev</DialogTitle>
          <DialogDescription>
            Confira os projetos e as portas antes de iniciar o ambiente de {cardId}.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {selected.length} de {projects.length} projetos selecionados
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10"
              disabled={pending}
              onClick={() =>
                setProjects(projects.map((project) => ({ ...project, selected: selected.length !== projects.length })))
              }
            >
              {selected.length === projects.length ? 'Desmarcar todos' : 'Selecionar todos'}
            </Button>
          </div>
          <div className="divide-y rounded-lg border">
            {projects.map((project) => (
              <div key={project.repo} className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-start gap-3 p-3">
                <div className="min-w-0">
                  <label className="flex min-h-10 cursor-pointer items-center gap-2">
                    <Checkbox
                      aria-label={`Executar ${project.repo}`}
                      checked={project.selected}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        setProjects(
                          projects.map((item) => (item.repo === project.repo ? { ...item, selected: checked } : item)),
                        )
                      }
                    />
                    <span className="min-w-0 break-words font-medium">{project.repo}</span>
                  </label>
                  <div className="space-y-1 pl-6 text-xs text-muted-foreground">
                    <p>
                      {project.kind === 'backend' ? 'Backend' : 'Frontend'} ·{' '}
                      {project.source === 'worktree' ? 'Worktree do card' : 'Repositório cadastrado'}
                    </p>
                    <p className="break-all font-mono text-[11px]">{project.directory}</p>
                    <p className="break-all font-mono text-[11px]">{project.command}</p>
                    <p className="font-mono tabular-nums">localhost:{project.port || '…'}</p>
                  </div>
                </div>
                <label className="space-y-1 pt-1 text-xs text-muted-foreground">
                  <span>Porta</span>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    step={1}
                    aria-label={`Porta de ${project.repo}`}
                    className="h-10 font-mono tabular-nums"
                    value={project.port}
                    disabled={pending || !project.selected}
                    onChange={(event) =>
                      setProjects(
                        projects.map((item) =>
                          item.repo === project.repo ? { ...item, port: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          {preview.dockerContainers.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-3">
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
                <Checkbox
                  aria-label="Iniciar containers Docker"
                  checked={docker}
                  disabled={pending || !dockerNeeded}
                  onCheckedChange={setDocker}
                />
                Iniciar containers Docker
              </label>
              <p className="pl-6 text-xs text-muted-foreground">
                {preview.platform === 'darwin' ? 'Desativado por padrão no macOS. ' : ''}
                Com esta opção desligada, os backends usam o banco e o Redis configurados no ambiente local.
              </p>
            </div>
          )}
          {preview.warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
              {warning}
            </p>
          ))}
          {(validation || error) && (
            <p role="alert" className="text-sm text-destructive">
              {validation || error}
            </p>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" className="min-h-10" disabled={pending} onClick={onClose}>
            Cancelar
          </Button>
          {onStartWithAgent && (
            <Button
              variant="outline"
              className="min-h-10"
              disabled={pending || !selected.length || Boolean(validation)}
              onClick={() =>
                onStartWithAgent({
                  projects: selected.map((project) => ({ repo: project.repo, port: Number(project.port) })),
                  docker: dockerNeeded && docker,
                })
              }
            >
              Iniciar com agente
            </Button>
          )}
          <Button
            className="min-h-10"
            disabled={pending || !selected.length || Boolean(validation)}
            onClick={() => void start()}
          >
            {pending && <Spinner className="size-4" />}
            Iniciar {selected.length === 1 ? '1 projeto' : `${selected.length} projetos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
