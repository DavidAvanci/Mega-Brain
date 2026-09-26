import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { requestJson } from '@/shared/api/request-json'
import type { Repository, RepositoryEnvironment, RepositoryEnvironmentKey } from '../../../shared/domain/repositories'

const environmentKeys: RepositoryEnvironmentKey[] = ['local', 'staging', 'prod']
const labels: Record<RepositoryEnvironmentKey, string> = { local: 'Local', staging: 'Staging', prod: 'Prod' }

export function RepositorySettingsDialog({
  repository,
  onClose,
  onSave,
}: {
  repository?: Repository
  onClose: () => void
  onSave: (id: string, environment: RepositoryEnvironmentKey, values: RepositoryEnvironment) => Promise<void>
}) {
  const [tab, setTab] = useState<RepositoryEnvironmentKey>('local')
  return (
    <Dialog
      open={!!repository}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {repository && (
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configurações de {repository.displayName}</DialogTitle>
            <DialogDescription className="break-all">{repository.path}</DialogDescription>
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
            key={`${repository.id}-${tab}`}
            repositoryId={repository.id}
            environmentKey={tab}
            environment={repository.environments[tab]}
            onSave={(values) => onSave(repository.id, tab, values)}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

function EnvironmentForm({
  repositoryId,
  environmentKey,
  environment,
  onSave,
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
    void requestJson<Record<string, string>>(
      `/api/repositories/env?id=${encodeURIComponent(repositoryId)}&environment=${environmentKey}`,
      'Falha ao carregar variáveis',
    )
      .then((values) => {
        if (active) {
          setVariables(Object.entries(values).map(([key, value]) => ({ key, value })))
          setVariablesLoaded(true)
        }
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
    return () => {
      active = false
    }
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
      await requestJson<Record<string, string>>(
        `/api/repositories/env?id=${encodeURIComponent(repositoryId)}`,
        'Falha ao salvar variáveis',
        { method: 'PUT', body: { environment: environmentKey, variables: envValues } },
      )
      const values: RepositoryEnvironment =
        environmentKey === 'local'
          ? {
              ...environment,
              enabled,
              startScript: startScript || undefined,
              port: port ? Number(port) : undefined,
              url: url || undefined,
              envFile: envFile || undefined,
            }
          : {
              ...environment,
              enabled,
              targetBranch: targetBranch || undefined,
              url: url || undefined,
              githubEnvironment: githubEnvironment || undefined,
              aws: {
                accountId: awsAccount || undefined,
                region: awsRegion || undefined,
                resources: environment.aws?.resources ?? [],
              },
            }
      values.migration = migrationCommand.trim()
        ? { backend, command: migrationCommand.trim().split(/\s+/), workingDirectory: migrationDirectory.trim() || '.' }
        : undefined
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
          <Field
            label="Branch alvo"
            value={targetBranch}
            onChange={setTargetBranch}
            placeholder={environmentKey === 'staging' ? 'staging' : 'main'}
          />
          <Field label="URL do serviço" value={url} onChange={setUrl} placeholder="https://" />
          <Field label="Ambiente GitHub" value={githubEnvironment} onChange={setGithubEnvironment} />
          <Field label="Conta AWS (opcional)" value={awsAccount} onChange={setAwsAccount} />
          <Field label="Região AWS (opcional)" value={awsRegion} onChange={setAwsRegion} />
        </>
      )}
      <section className="col-span-full grid gap-2 rounded-md border p-3">
        <h3 className="text-sm font-medium">Migração após atualização do checkout</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={backend} onChange={(event) => setBackend(event.target.checked)} />
          Backend com migração
        </label>
        <Field
          label="Comando permitido (argumentos separados por espaço)"
          value={migrationCommand}
          onChange={setMigrationCommand}
          placeholder="npm run migrate"
        />
        <Field
          label="Diretório relativo ao checkout"
          value={migrationDirectory}
          onChange={setMigrationDirectory}
          placeholder="."
        />
      </section>
      <section className="col-span-full grid gap-2 rounded-md border p-3">
        <div>
          <h3 className="text-sm font-medium">Variáveis de ambiente</h3>
          <p className="text-xs text-muted-foreground">
            Salvas em{' '}
            {environmentKey === 'local' ? '.env.local' : environmentKey === 'staging' ? '.env.staging' : '.env.prod'} no
            checkout.
          </p>
        </div>
        {variables.map((entry, index) => (
          <div key={index} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
            <Input
              aria-label="Nome da variável"
              placeholder="API_URL"
              value={entry.key}
              onChange={(event) =>
                setVariables((rows) => rows.map((row, i) => (i === index ? { ...row, key: event.target.value } : row)))
              }
            />
            <Input
              aria-label="Valor da variável"
              value={entry.value}
              onChange={(event) =>
                setVariables((rows) =>
                  rows.map((row, i) => (i === index ? { ...row, value: event.target.value } : row)),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setVariables((rows) => rows.filter((_, i) => i !== index))}
            >
              Remover
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          onClick={() => setVariables((rows) => [...rows, { key: '', value: '' }])}
        >
          Adicionar variável
        </Button>
      </section>
      <div className="col-span-full flex justify-end">
        <Button type="submit" disabled={saving || !variablesLoaded}>
          {saving ? 'Salvando…' : `Salvar ${labels[environmentKey]}`}
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="bg-background text-foreground"
      />
    </label>
  )
}
