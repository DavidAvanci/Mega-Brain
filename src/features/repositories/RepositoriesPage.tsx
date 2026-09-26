import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpenIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/shared/api/api-client'
import { requestJson } from '@/shared/api/request-json'
import { isTauriDesktop, pickDesktopWslDirectory } from '../../desktopBootstrap'
import type {
  Repository,
  RepositoryDirtyAction,
  RepositoryEnvironment,
  RepositoryEnvironmentKey,
  RepositoryStatus,
  RepositoryMigrationResult,
} from '../../../shared/domain/repositories'

const environmentKeys: RepositoryEnvironmentKey[] = ['local', 'staging', 'prod']
const labels: Record<RepositoryEnvironmentKey, string> = { local: 'Local', staging: 'Staging', prod: 'Prod' }
type Preview = { path: string; displayName: string; alias: string; origin?: string; duplicateId?: string }
type Discovery = { path: string; repositories: { preview: Preview; alias: string }[] }

export function RepositoriesPage() {
  const [repositories, setRepositories] = useState<Repository[]>([])
  const [statuses, setStatuses] = useState<Record<string, RepositoryStatus>>({})
  const [remoteBusy, setRemoteBusy] = useState<string | null>(null)
  const [migrations, setMigrations] = useState<Record<string, RepositoryMigrationResult>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tab, setTab] = useState<RepositoryEnvironmentKey>('local')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
  const [busy, setBusy] = useState(false)
  const [decisionId, setDecisionId] = useState<string | null>(null)
  const [decisionAction, setDecisionAction] = useState<RepositoryDirtyAction | null>(null)
  const [commitMessage, setCommitMessage] = useState('chore: salvar alterações antes de ir para master')
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const editing = repositories.find((repository) => repository.id === editingId)
  const deciding = repositories.find((repository) => repository.id === decisionId)
  const visible = useMemo(
    () => repositories.filter((repo) =>
      `${repo.displayName} ${repo.alias} ${repo.path}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')),
    ),
    [repositories, query],
  )

  const refreshStatus = useCallback(async (id: string) => {
    try {
      const status = await requestJson<RepositoryStatus>(
        `/api/repositories/status?id=${encodeURIComponent(id)}`,
        'Falha ao verificar repositório',
      )
      setStatuses((current) => ({ ...current, [id]: status }))
    } catch (error) {
      setStatuses((current) => ({
        ...current,
        [id]: {
          available: false,
          path: '',
          checkedAt: new Date().toISOString(),
          source: 'local', state: 'unavailable',
          error: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }, [])

  const load = useCallback(async () => {
    const list = await requestJson<Repository[]>('/api/repositories', 'Falha ao carregar repositórios')
    setRepositories(list)
    await Promise.all(list.map((repo) => refreshStatus(repo.id)))
    await Promise.all(list.map(async (repo) => {
      const result = await requestJson<RepositoryMigrationResult>(`/api/repositories/migration?id=${encodeURIComponent(repo.id)}`, 'Falha ao consultar migração').catch(() => ({ state: 'idle' as const }))
      setMigrations((current) => ({ ...current, [repo.id]: result }))
    }))
  }, [refreshStatus])

  useEffect(() => {
    void load().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error), { id: 'repositories-load' })
    })
  }, [load])

  const chooseDirectory = async () => {
    setBusy(true)
    try {
      const selected = await pickDesktopWslDirectory('repository')
      if (selected === null) return
      setPreview(null)
      setDiscovery(null)
      const result = await requestJson<Preview>('/api/repositories/preview', 'Falha ao validar checkout', {
        method: 'POST', body: { path: selected },
      })
      setPreview(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const chooseParentDirectory = async () => {
    setBusy(true)
    try {
      const selected = await pickDesktopWslDirectory('repository-parent')
      if (selected === null) return
      setPreview(null)
      const result = await requestJson<{ path: string; repositories: Preview[] }>(
        '/api/repositories/discover', 'Falha ao buscar repositórios na pasta',
        { method: 'POST', body: { path: selected } },
      )
      setDiscovery({ path: result.path, repositories: result.repositories.map((item) => ({ preview: item, alias: item.alias })) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const discoveredProblem = (item: Discovery['repositories'][number]): string | null => {
    if (item.preview.duplicateId || repositories.some((repo) => repo.path === item.preview.path)) return 'Já cadastrado'
    if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(item.alias.trim())) return 'Alias inválido'
    if (repositories.some((repo) => repo.alias.toLowerCase() === item.alias.trim().toLowerCase())) return 'Alias já cadastrado'
    return null
  }

  const addDiscovered = async (item: Discovery['repositories'][number]) => {
    if (discoveredProblem(item)) return
    setBusy(true)
    try {
      const repo = await requestJson<Repository>('/api/repositories', 'Falha ao cadastrar repositório', {
        method: 'POST',
        body: { path: item.preview.path, alias: item.alias.trim(), displayName: item.preview.displayName },
      })
      setDiscovery((current) => current && ({
        ...current, repositories: current.repositories.filter((candidate) => candidate.preview.path !== repo.path),
      }))
      toast.success(`${repo.displayName} cadastrado`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const repo = await requestJson<Repository>('/api/repositories', 'Falha ao cadastrar repositório', {
        method: 'POST',
        body: { path: preview.path, alias: preview.alias, displayName: preview.displayName },
      })
      setPreview(null)
      await load()
      setEditingId(repo.id)
      setTab('local')
      toast.success(`${repo.displayName} cadastrado`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const update = async (id: string, patch: Record<string, unknown>) => {
    const repo = await requestJson<Repository>(`/api/repositories?id=${encodeURIComponent(id)}`, 'Falha ao salvar repositório', {
      method: 'PATCH', body: patch,
    })
    setRepositories((current) => current.map((item) => item.id === id ? repo : item))
  }

  const toggleActive = async (repo: Repository) => {
    try {
      await update(repo.id, { active: !repo.active })
      toast.success(repo.active ? 'Repositório desativado' : 'Repositório ativado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const goToMaster = async (repo: Repository, action?: RepositoryDirtyAction) => {
    setSwitchingId(repo.id)
    try {
      const status = await requestJson<RepositoryStatus>('/api/repositories/switch-master', 'Falha ao trocar para master', {
        method: 'POST',
        body: { id: repo.id, dirtyAction: action, commitMessage: action === 'commit' ? commitMessage : undefined },
      })
      setStatuses((current) => ({ ...current, [repo.id]: status }))
      setDecisionId(null)
      toast.success(`${repo.displayName} agora está na master`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setDecisionId(repo.id)
        setDecisionAction(null)
        setConfirmDiscard(false)
        await refreshStatus(repo.id)
      } else {
        const detail = error instanceof Error ? error.message : String(error)
        toast.error(detail)
      }
    } finally {
      setSwitchingId(null)
    }
  }

  const verifyRemote = async (id: string) => {
    setRemoteBusy(id)
    try {
      const status = await requestJson<RepositoryStatus>('/api/repositories/verify', 'Falha ao verificar remoto', { method: 'POST', body: { id } })
      setStatuses((current) => ({ ...current, [id]: status }))
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setRemoteBusy(null) }
  }

  const verifyAll = async () => {
    setRemoteBusy('all')
    try {
      const results = await requestJson<Record<string, RepositoryStatus>>('/api/repositories/verify', 'Falha ao verificar remotos', { method: 'POST', body: { ids: repositories.map((repo) => repo.id) } })
      setStatuses((current) => ({ ...current, ...results }))
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setRemoteBusy(null) }
  }

  const pull = async (id: string) => {
    setRemoteBusy(id)
    try {
      const status = await requestJson<RepositoryStatus>('/api/repositories/pull', 'Falha ao atualizar checkout', { method: 'POST', body: { id } })
      setStatuses((current) => ({ ...current, [id]: status }))
      if (status.error) toast.error(status.error)
      else toast.success('Checkout atualizado')
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); await refreshStatus(id) }
    finally { setRemoteBusy(null) }
  }

  const migrate = async (id: string, environment: RepositoryEnvironmentKey) => {
    setRemoteBusy(id)
    try {
      const result = await requestJson<RepositoryMigrationResult>('/api/repositories/migration', 'Falha ao executar migração', { method: 'POST', body: { id, environment } })
      setMigrations((current) => ({ ...current, [id]: result }))
      if (result.state === 'failure') toast.error(result.error ?? 'Migração falhou')
      else toast.success('Migração concluída')
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { setRemoteBusy(null) }
  }

  const openEditor = (id: string) => {
    setEditingId(id)
    setTab('local')
  }

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto bg-background p-5 md:p-8" aria-label="Página Repositórios">
      <div className="w-full space-y-6">
        <header>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Catálogo local</p>
          <h2 className="mt-1 text-2xl font-semibold">Repositórios</h2>
          <p className="mt-1 text-sm text-muted-foreground">Checkouts locais e configuração de cada ambiente.</p>
          <Button type="button" variant="outline" size="sm" className="mt-3" disabled={remoteBusy !== null || repositories.length === 0} onClick={() => void verifyAll()}>Verificar remoto de todos</Button>
        </header>

        <section className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">Adicionar repositório</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {isTauriDesktop() && (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void chooseDirectory()}>
                  <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
                  Escolher repositório
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void chooseParentDirectory()}>
                  <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
                  Escolher pasta com repositórios
                </Button>
              </>
            )}
          </div>
          {discovery && (
            <div className="mt-4 space-y-3" aria-label="Repositórios encontrados na pasta">
              <p className="break-all text-xs text-muted-foreground">Pasta: {discovery.path}</p>
              {discovery.repositories.length === 0 && (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhum repositório Git pendente nas subpastas diretas.</p>
              )}
              {discovery.repositories.map((item) => {
                const problem = discoveredProblem(item)
                return (
                  <div key={item.preview.path} className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
                    <div className="min-w-48 flex-1">
                      <p className="font-medium">{item.preview.displayName}</p>
                      <p className="break-all text-xs text-muted-foreground">{item.preview.path}</p>
                      <p className="break-all text-xs text-muted-foreground">origin: {item.preview.origin ?? 'não configurado'}</p>
                      {problem && <p className="text-xs text-destructive">{problem}</p>}
                    </div>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Alias
                      <Input
                        aria-label={`Alias de ${item.preview.displayName}`}
                        value={item.alias}
                        disabled={busy || !!item.preview.duplicateId}
                        onChange={(event) => setDiscovery((current) => current && ({
                          ...current,
                          repositories: current.repositories.map((candidate) => candidate.preview.path === item.preview.path
                            ? { ...candidate, alias: event.target.value } : candidate),
                        }))}
                        className="w-44 bg-background text-foreground"
                      />
                    </label>
                    <Button type="button" disabled={busy || !!problem} onClick={() => void addDiscovered(item)}>Adicionar</Button>
                  </div>
                )
              })}
            </div>
          )}
          {preview && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3 text-sm">
              <span>
                <b>{preview.displayName}</b> · alias <code>{preview.alias}</code> · {preview.origin ?? 'sem origin'}
                {preview.duplicateId ? ' · já cadastrado' : ''}
              </span>
              <Button type="button" disabled={!!preview.duplicateId || busy} onClick={() => void add()}>Adicionar</Button>
            </div>
          )}
        </section>

        <section className="w-full space-y-3" aria-label="Lista de repositórios">
          <Input
            aria-label="Buscar repositórios"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome, alias ou caminho"
            className="bg-background"
          />
          {visible.length === 0 && (
            <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Nenhum repositório encontrado.</p>
          )}
          {visible.map((repo) => {
            const status = statuses[repo.id]
            const migration = migrations[repo.id]
            const configuredMigrations = environmentKeys.filter((key) => repo.environments[key]?.migration?.backend)
            const pullBlock = !status?.available ? 'Checkout indisponível' : status.dirty ? 'Há alterações locais' : status.state === 'no-upstream' ? 'Sem upstream' : status.state === 'diverged' ? 'Branch divergente' : status.state === 'ahead' ? 'Branch à frente' : status.state === 'remote-failed' ? 'Falha de rede' : status.state !== 'behind' ? 'Checkout já atualizado' : status.source !== 'remote' ? 'Verifique o remoto primeiro' : null
            return (
              <article key={repo.id} className="w-full rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold">{repo.displayName}</h3>
                      <code className="rounded-lg bg-muted px-2 py-0.5 text-xs">{repo.alias}</code>
                      <span className={`text-xs ${repo.active ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                        {repo.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <p className="break-all text-xs text-muted-foreground">{repo.path}</p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span>{status?.available ? `Branch: ${status.branch || 'detached'}` : status?.error ?? 'Verificando Git…'}</span>
                      {status?.available && <span>{status.dirty ? 'Alterações locais' : 'Checkout limpo'}</span>}
                      <span className="break-all">origin: {status?.origin ?? repo.githubUrl ?? 'não configurado'}</span>
                      <span>Upstream: {status?.upstream ?? 'não configurado'}</span>
                      <span>Estado: {status ? ({ 'up-to-date': status.source === 'remote' ? 'Atualizado' : 'Remoto não verificado', behind: 'Atrás', ahead: 'À frente', diverged: 'Divergente', 'no-upstream': 'Sem upstream', unavailable: 'Indisponível', 'remote-failed': 'Falha de rede' }[status.state]) : 'Carregando…'} {status?.ahead !== undefined ? `(${status.ahead} à frente, ${status.behind} atrás)` : ''}</span>
                      <span>{status?.source === 'remote' ? `Remoto verificado em ${status.remoteCheckedAt ? new Date(status.remoteCheckedAt).toLocaleString() : 'agora'}` : 'Dados locais; remoto ainda não verificado nesta ação'}</span>
                      {status?.error && <span className="text-destructive">{status.error}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {status?.available && status.branch !== 'master' && (
                      <Button type="button" variant="outline" size="sm" disabled={switchingId === repo.id} onClick={() => void goToMaster(repo)}>
                        {switchingId === repo.id ? 'Trocando…' : 'Ir para master'}
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="sm" disabled={remoteBusy !== null} onClick={() => void verifyRemote(repo.id)}>Verificar remoto</Button>
                    <Button type="button" variant="outline" size="sm" title={pullBlock ?? undefined} disabled={remoteBusy !== null || !!pullBlock} onClick={() => void pull(repo.id)}>Atualizar checkout</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void toggleActive(repo)}>
                      {repo.active ? 'Desativar' : 'Ativar'}
                    </Button>
                    <Button type="button" size="sm" onClick={() => openEditor(repo.id)}>
                      Editar
                    </Button>
                  </div>
                </div>
                {pullBlock && <p className="mt-2 text-xs text-muted-foreground">Atualização indisponível: {pullBlock}.</p>}
                {configuredMigrations.map((key) => { const config = repo.environments[key].migration!; return (
                  <div key={key} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span>Migração {labels[key]}: <code>{config.command.join(' ')}</code> em <code>{config.workingDirectory}</code></span>
                    {status?.migrationReady && <Button type="button" size="sm" variant="outline" disabled={remoteBusy !== null} onClick={() => void migrate(repo.id, key)}>Executar migrações</Button>}
                  </div>
                ) })}
                {migration && migration.state !== 'idle' && <p className="mt-2 text-xs">Migração {migration.environment ? labels[migration.environment] : ''}: {migration.state === 'success' ? 'sucesso' : migration.state === 'failure' ? 'falha' : 'executando'} {migration.error ?? migration.output ?? ''}</p>}
              </article>
            )
          })}
        </section>
      </div>

      <Dialog open={decisionId !== null} onOpenChange={(open) => { if (!open && !switchingId) setDecisionId(null) }}>
        {deciding && (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Ir para master em {deciding.displayName}</DialogTitle>
              <DialogDescription>
                A branch atual tem alterações não commitadas. Escolha como tratá-las antes de trocar para master.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2" role="radiogroup" aria-label="Destino das alterações locais">
              {([
                ['commit', 'Criar commit', 'Inclui alterações rastreadas e arquivos novos no commit atual.'],
                ['stash', 'Guardar no stash', 'Guarda também arquivos novos para restaurar depois.'],
                ['discard', 'Descartar alterações', 'Remove alterações e arquivos novos deste checkout.'],
              ] as const).map(([value, label, description]) => (
                <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                  <input type="radio" name="master-dirty-action" value={value} checked={decisionAction === value} onChange={() => { setDecisionAction(value); setConfirmDiscard(false) }} />
                  <span><span className="block font-medium">{label}</span><span className="text-xs text-muted-foreground">{description}</span></span>
                </label>
              ))}
            </div>
            {decisionAction === 'commit' && (
              <label className="grid gap-1 text-xs text-muted-foreground">
                Mensagem do commit
                <Input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
              </label>
            )}
            {decisionAction === 'discard' && (
              <label className="flex items-center gap-2 text-sm text-destructive">
                <input type="checkbox" checked={confirmDiscard} onChange={(event) => setConfirmDiscard(event.target.checked)} />
                Confirmo que quero descartar as alterações locais
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={switchingId !== null} onClick={() => setDecisionId(null)}>Cancelar</Button>
              <Button
                type="button"
                disabled={!decisionAction || switchingId !== null || (decisionAction === 'commit' && !commitMessage.trim()) || (decisionAction === 'discard' && !confirmDiscard)}
                onClick={() => { if (decisionAction) void goToMaster(deciding, decisionAction) }}
              >
                {switchingId ? 'Trocando…' : 'Confirmar e ir para master'}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={editingId !== null} onOpenChange={(open) => { if (!open) setEditingId(null) }}>
        {editing && (
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Configurações de {editing.displayName}</DialogTitle>
              <DialogDescription>{editing.path}</DialogDescription>
            </DialogHeader>
            <nav className="flex gap-1 border-b" aria-label="Ambiente do repositório">
              {environmentKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={tab === key ? 'page' : undefined}
                  className={`px-3 py-2 text-sm ${tab === key ? 'border-b-2 border-primary font-medium' : 'text-muted-foreground'}`}
                >
                  {labels[key]}
                </button>
              ))}
            </nav>
            <EnvironmentForm
              key={`${editing.id}-${tab}`}
              repositoryId={editing.id}
              environmentKey={tab}
              environment={editing.environments[tab]}
              onSave={(values) => update(editing.id, { environments: { [tab]: values } })}
            />
          </DialogContent>
        )}
      </Dialog>
    </main>
  )
}

function EnvironmentForm({
  repositoryId, environmentKey, environment, onSave,
}: {
  repositoryId: string
  environmentKey: RepositoryEnvironmentKey
  environment: RepositoryEnvironment
  onSave: (values: RepositoryEnvironment) => Promise<void>
}) {
  const [enabled, setEnabled] = useState(environment.enabled)
  const [backend, setBackend] = useState(environment.migration?.backend ?? false)
  const [migrationCommand, setMigrationCommand] = useState(environment.migration?.command.join(' ') ?? '')
  const [migrationDirectory, setMigrationDirectory] = useState(environment.migration?.workingDirectory ?? '.')
  const [startScript, setStartScript] = useState(environment.startScript ?? '')
  const [port, setPort] = useState(environment.port?.toString() ?? '')
  const [url, setUrl] = useState(environment.url ?? '')
  const [envFile, setEnvFile] = useState(environment.envFile ?? '')
  const [targetBranch, setTargetBranch] = useState(environment.targetBranch ?? '')
  const [githubEnvironment, setGithubEnvironment] = useState(environment.githubEnvironment ?? '')
  const [awsAccount, setAwsAccount] = useState(environment.aws?.accountId ?? '')
  const [awsRegion, setAwsRegion] = useState(environment.aws?.region ?? '')
  const [saving, setSaving] = useState(false)
  const [variables, setVariables] = useState<{ key: string; value: string }[]>([])
  const [variablesLoaded, setVariablesLoaded] = useState(false)

  useEffect(() => {
    let active = true
    void requestJson<Record<string, string>>(`/api/repositories/env?id=${encodeURIComponent(repositoryId)}&environment=${environmentKey}`, 'Falha ao carregar variáveis')
      .then((values) => { if (active) { setVariables(Object.entries(values).map(([key, value]) => ({ key, value }))); setVariablesLoaded(true) } })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
    return () => { active = false }
  }, [repositoryId, environmentKey])

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    try {
      if (!variablesLoaded) throw new Error('Aguarde o carregamento das variáveis')
      const envValues: Record<string, string> = {}
      for (const entry of variables) {
        const key = entry.key.trim()
        if (!key) continue
        if (Object.hasOwn(envValues, key)) throw new Error(`Variável duplicada: ${key}`)
        envValues[key] = entry.value
      }
      await requestJson<Record<string, string>>(`/api/repositories/env?id=${encodeURIComponent(repositoryId)}`, 'Falha ao salvar variáveis', { method: 'PUT', body: { environment: environmentKey, variables: envValues } })
      const values: RepositoryEnvironment = environmentKey === 'local'
        ? { ...environment, enabled, startScript: startScript || undefined, port: port ? Number(port) : undefined, url: url || undefined, envFile: envFile || undefined }
        : { ...environment, enabled, targetBranch: targetBranch || undefined, url: url || undefined, githubEnvironment: githubEnvironment || undefined, aws: { accountId: awsAccount || undefined, region: awsRegion || undefined, resources: environment.aws?.resources ?? [] } }
      values.migration = migrationCommand.trim() ? { backend, command: migrationCommand.trim().split(/\s+/), workingDirectory: migrationDirectory.trim() || '.' } : undefined
      await onSave(values)
      toast.success(`${labels[environmentKey]} salvo`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
      <label className="col-span-full flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Ambiente habilitado
      </label>
      {environmentKey === 'local' ? (
        <>
          <Field label="Script conhecido" value={startScript} onChange={setStartScript} placeholder="dev" />
          <Field label="Porta" value={port} onChange={setPort} placeholder="3000" type="number" />
          <Field label="URL local" value={url} onChange={setUrl} placeholder="http://localhost:3000" />
          <Field label="Arquivo de variáveis (caminho)" value={envFile} onChange={setEnvFile} />
        </>
      ) : (
        <>
          <Field label="Branch alvo" value={targetBranch} onChange={setTargetBranch} placeholder={environmentKey === 'staging' ? 'staging' : 'main'} />
          <Field label="URL do serviço" value={url} onChange={setUrl} placeholder="https://" />
          <Field label="Ambiente GitHub" value={githubEnvironment} onChange={setGithubEnvironment} />
          <Field label="Conta AWS (opcional)" value={awsAccount} onChange={setAwsAccount} />
          <Field label="Região AWS (opcional)" value={awsRegion} onChange={setAwsRegion} />
        </>
      )}
      <section className="col-span-full grid gap-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">Migração após atualização do checkout</h3>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={backend} onChange={(event) => setBackend(event.target.checked)} />Backend com migração</label>
        <Field label="Comando permitido (argumentos separados por espaço)" value={migrationCommand} onChange={setMigrationCommand} placeholder="npm run migrate" />
        <Field label="Diretório relativo ao checkout" value={migrationDirectory} onChange={setMigrationDirectory} placeholder="." />
      </section>
      <section className="col-span-full grid gap-2 rounded-md border p-3">
        <div><h3 className="text-sm font-medium">Variáveis de ambiente</h3><p className="text-xs text-muted-foreground">Salvas em {environmentKey === 'local' ? '.env.local' : environmentKey === 'staging' ? '.env.staging' : '.env.prod'} no checkout.</p></div>
        {variables.map((entry, index) => (
          <div key={index} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
            <Input aria-label="Nome da variável" placeholder="API_URL" value={entry.key} onChange={(event) => setVariables((rows) => rows.map((row, i) => i === index ? { ...row, key: event.target.value } : row))} />
            <Input aria-label="Valor da variável" value={entry.value} onChange={(event) => setVariables((rows) => rows.map((row, i) => i === index ? { ...row, value: event.target.value } : row))} />
            <Button type="button" variant="ghost" onClick={() => setVariables((rows) => rows.filter((_, i) => i !== index))}>Remover</Button>
          </div>
        ))}
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => setVariables((rows) => [...rows, { key: '', value: '' }])}>Adicionar variável</Button>
      </section>
      <div className="col-span-full flex justify-end">
        <Button type="submit" disabled={saving || !variablesLoaded}>{saving ? 'Salvando…' : `Salvar ${labels[environmentKey]}`}</Button>
      </div>
    </form>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="bg-background text-foreground" />
    </label>
  )
}
