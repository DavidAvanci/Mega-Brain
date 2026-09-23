import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  Repository,
  RepositoryEnvironment,
  RepositoryEnvironmentKey,
  RepositoryRegistryFile,
  RepositoryStatus,
} from '../../shared/domain/repositories'
import type { ProcessRunner } from '../process'

const environmentKeys: RepositoryEnvironmentKey[] = ['local', 'staging', 'prod']
const emptyEnvironment = (): RepositoryEnvironment => ({ enabled: false })
const emptyRegistry = (): RepositoryRegistryFile => ({ version: 1, repositories: [] })

export class RepositoryDirtyError extends Error {
  constructor() {
    super('O repositório tem alterações não commitadas. Escolha commit, stash ou descarte antes de ir para master.')
  }
}

export class RepositoryRegistry {
  constructor(private readonly file: string, private readonly runner: ProcessRunner) {}

  async list(): Promise<Repository[]> {
    return (await this.read()).repositories
  }

  async preview(value: unknown): Promise<{ path: string; displayName: string; alias: string; origin?: string; duplicateId?: string }> {
    const path = await this.validatePath(value)
    const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? 'repository'
    const origin = safeOrigin(await this.git(path, ['config', '--get', 'remote.origin.url']).catch(() => undefined))
    const duplicateId = (await this.list()).find((repo) => repo.path === path)?.id
    return { path, displayName: name, alias: slug(name), origin, duplicateId }
  }

  async discover(value: unknown): Promise<{ path: string; repositories: Awaited<ReturnType<RepositoryRegistry['preview']>>[] }> {
    if (typeof value !== 'string' || !isAbsolute(value.trim()) || /[\r\n\0]/.test(value)) {
      throw new Error('Escolha uma pasta absoluta válida')
    }
    const path = await realpath(value.trim())
    if (!(await stat(path)).isDirectory()) throw new Error('O caminho escolhido não é uma pasta')
    const directories = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== '.git')
      .map((entry) => join(path, entry.name))
      .sort((left, right) => left.localeCompare(right, 'pt-BR'))
    if (directories.length > 1000) throw new Error('A pasta contém subpastas demais para a busca de repositórios')
    const repositories: Awaited<ReturnType<RepositoryRegistry['preview']>>[] = []
    for (let index = 0; index < directories.length; index += 8) {
      const group = await Promise.all(directories.slice(index, index + 8).map(async (directory) => {
        if (!await stat(join(directory, '.git')).catch(() => null)) return null
        return this.preview(directory).catch(() => null)
      }))
      for (const repository of group) if (repository) repositories.push(repository)
    }
    return { path, repositories }
  }

  async create(input: unknown): Promise<Repository> {
    if (!isRecord(input)) throw new Error('Dados do repositório inválidos')
    const preview = await this.preview(input.path)
    const file = await this.read()
    const alias = typeof input.alias === 'string' ? input.alias.trim() : preview.alias
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : preview.displayName
    validateAlias(alias)
    if (!displayName) throw new Error('Nome do repositório é obrigatório')
    if (file.repositories.some((repo) => repo.path === preview.path)) throw new Error('Este checkout já está cadastrado')
    if (file.repositories.some((repo) => repo.alias.toLowerCase() === alias.toLowerCase())) throw new Error(`Alias já está em uso: ${alias}`)
    const repository: Repository = {
      id: `repo_${randomUUID().replaceAll('-', '')}`,
      alias, displayName, path: preview.path, active: true, tags: [],
      githubUrl: input.githubUrl === undefined ? webOrigin(preview.origin) : optionalWebUrl(input.githubUrl),
      environments: normalizeEnvironments(input.environments),
    }
    validateCompanions(repository, file.repositories)
    file.repositories.push(repository)
    await this.write(file)
    return repository
  }

  async update(id: string, patch: unknown): Promise<Repository> {
    if (!isRecord(patch)) throw new Error('Dados de atualização inválidos')
    const file = await this.read()
    const index = file.repositories.findIndex((repo) => repo.id === id)
    if (index < 0) throw new Error('Repositório não encontrado')
    const old = file.repositories[index]
    const next: Repository = { ...old }
    if ('path' in patch) next.path = await this.validatePath(patch.path)
    if ('alias' in patch) {
      if (typeof patch.alias !== 'string') throw new Error('Alias inválido')
      validateAlias(patch.alias.trim())
      next.alias = patch.alias.trim()
    }
    if ('displayName' in patch) {
      if (typeof patch.displayName !== 'string' || !patch.displayName.trim()) throw new Error('Nome inválido')
      next.displayName = patch.displayName.trim()
    }
    if ('active' in patch) {
      if (typeof patch.active !== 'boolean') throw new Error('Estado inválido')
      next.active = patch.active
    }
    if ('tags' in patch) next.tags = stringList(patch.tags, 'tags')
    if ('githubUrl' in patch) next.githubUrl = optionalWebUrl(patch.githubUrl)
    if ('environments' in patch) {
      if (!isRecord(patch.environments)) throw new Error('Ambientes inválidos')
      next.environments = normalizeEnvironments({ ...old.environments, ...patch.environments })
    }
    if (file.repositories.some((repo) => repo.id !== id && (repo.path === next.path || repo.alias.toLowerCase() === next.alias.toLowerCase()))) {
      throw new Error('Caminho ou alias já está cadastrado')
    }
    validateCompanions(next, file.repositories.filter((repo) => repo.id !== id))
    file.repositories[index] = next
    await this.write(file)
    return next
  }

  async status(id: string): Promise<RepositoryStatus> {
    const repository = (await this.list()).find((repo) => repo.id === id)
    if (!repository) throw new Error('Repositório não encontrado')
    const checkedAt = new Date().toISOString()
    try {
      const path = await realpath(repository.path)
      const [branch, dirty, origin] = await Promise.all([
        this.git(path, ['branch', '--show-current']),
        this.git(path, ['status', '--porcelain']).then((text) => text.length > 0),
        this.git(path, ['config', '--get', 'remote.origin.url']).then(safeOrigin).catch(() => undefined),
      ])
      return { available: true, path, branch, dirty, origin, checkedAt }
    } catch (error) {
      return { available: false, path: repository.path, checkedAt, error: message(error) }
    }
  }

  async switchToMaster(id: unknown, dirtyAction?: unknown, commitMessage?: unknown): Promise<RepositoryStatus> {
    if (typeof id !== 'string' || !id) throw new Error('Repositório não encontrado')
    const repository = (await this.list()).find((item) => item.id === id)
    if (!repository) throw new Error('Repositório não encontrado')
    const path = await this.validatePath(repository.path)
    const branch = await this.git(path, ['branch', '--show-current'])
    if (branch === 'master') return this.status(id)

    const master = await this.git(path, ['rev-parse', '--verify', '--quiet', 'refs/heads/master']).catch(() => '')
    if (!master) throw new Error('Este repositório não possui uma branch local master')
    const worktrees = await this.git(path, ['worktree', 'list', '--porcelain'])
    for (const block of worktrees.split(/\n\s*\n/)) {
      if (!block.split('\n').includes('branch refs/heads/master')) continue
      const worktree = block.split('\n').find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
      if (worktree && await realpath(worktree).catch(() => worktree) !== path) {
        throw new Error(`A branch master já está aberta em outra worktree: ${worktree}`)
      }
    }

    const dirty = Boolean(await this.git(path, ['status', '--porcelain']))
    if (dirty) {
      if (dirtyAction === undefined) throw new RepositoryDirtyError()
      if (dirtyAction !== 'commit' && dirtyAction !== 'stash' && dirtyAction !== 'discard') {
        throw new Error('Ação inválida para alterações locais')
      }
      if (dirtyAction === 'commit') {
        if (typeof commitMessage !== 'string' || !commitMessage.trim()) throw new Error('Informe a mensagem do commit')
        await this.git(path, ['add', '--all'])
        await this.git(path, ['commit', '-m', commitMessage.trim()], 60_000)
      } else if (dirtyAction === 'stash') {
        await this.git(path, ['stash', 'push', '--include-untracked', '-m', 'Mega Brain: antes de ir para master'], 30_000)
      } else {
        await this.git(path, ['reset', '--hard', 'HEAD'])
        await this.git(path, ['clean', '-fd'])
      }
    }
    await this.git(path, ['switch', 'master'])
    return this.status(id)
  }

  private async validatePath(value: unknown): Promise<string> {
    if (typeof value !== 'string' || !isAbsolute(value.trim()) || /[\r\n\0]/.test(value)) throw new Error('Informe um caminho absoluto válido')
    const path = await realpath(value.trim())
    if (await this.git(path, ['rev-parse', '--is-bare-repository']) === 'true') throw new Error('Repositórios bare não podem ser cadastrados')
    if (await this.git(path, ['rev-parse', '--show-toplevel']) !== path) throw new Error('O caminho precisa apontar para a raiz do checkout Git')
    const gitDir = await this.git(path, ['rev-parse', '--absolute-git-dir'])
    if (/[\\/]\.git[\\/]worktrees[\\/]/.test(gitDir)) throw new Error('Worktrees gerenciadas não podem ser cadastradas como repositórios')
    return path
  }

  private git(cwd: string, args: string[], timeout = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.runner.execFile('git', args, { cwd, timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message))
        else resolve(stdout.trim())
      })
    })
  }

  private async read(): Promise<RepositoryRegistryFile> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.repositories)) throw new Error('Versão do catálogo de repositórios não suportada')
      return value as unknown as RepositoryRegistryFile
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry()
      throw error
    }
  }

  private async write(value: RepositoryRegistryFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = join(dirname(this.file), `.repositories-${randomUUID()}.tmp`)
    try {
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
      await chmod(temp, 0o600)
      await rename(temp, this.file)
    } finally {
      await rm(temp, { force: true })
    }
  }
}

function normalizeEnvironments(value: unknown): Repository['environments'] {
  if (value !== undefined && !isRecord(value)) throw new Error('Ambientes inválidos')
  const source = value as Record<string, unknown> | undefined
  const result: Repository['environments'] = { local: emptyEnvironment(), staging: emptyEnvironment(), prod: emptyEnvironment() }
  for (const key of environmentKeys) {
    const raw = source?.[key]
    if (raw === undefined) continue
    if (!isRecord(raw) || typeof raw.enabled !== 'boolean') throw new Error(`Ambiente ${key} inválido`)
    const environment: RepositoryEnvironment = { enabled: raw.enabled }
    for (const field of ['startScript', 'url', 'envFile', 'targetBranch', 'githubEnvironment'] as const) {
      if (raw[field] !== undefined) {
        if (typeof raw[field] !== 'string') throw new Error(`Campo ${field} inválido no ambiente ${key}`)
        environment[field] = raw[field].trim() || undefined
      }
    }
    if (raw.port !== undefined) {
      if (!Number.isInteger(raw.port) || (raw.port as number) < 1 || (raw.port as number) > 65535) throw new Error(`Porta inválida no ambiente ${key}`)
      environment.port = raw.port as number
    }
    for (const field of ['companionRepositoryIds', 'variableSourceRefs'] as const) {
      if (raw[field] !== undefined) environment[field] = stringList(raw[field], field)
    }
    if (raw.aws !== undefined) {
      if (!isRecord(raw.aws)) throw new Error(`AWS inválido no ambiente ${key}`)
      const aws = raw.aws
      if (aws.accountId !== undefined && (typeof aws.accountId !== 'string' || !/^\d{12}$/.test(aws.accountId))) throw new Error(`Conta AWS inválida no ambiente ${key}`)
      if (aws.region !== undefined && (typeof aws.region !== 'string' || !/^[a-z]{2}-[a-z]+-\d$/.test(aws.region))) throw new Error(`Região AWS inválida no ambiente ${key}`)
      environment.aws = {
        accountId: aws.accountId as string | undefined,
        region: aws.region as string | undefined,
        resources: aws.resources === undefined ? [] : stringList(aws.resources, 'resources'),
      }
    }
    if (environment.url) environment.url = optionalWebUrl(environment.url)
    if (environment.envFile && !isAbsolute(environment.envFile)) throw new Error(`envFile deve ser absoluto no ambiente ${key}`)
    if (environment.targetBranch && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(environment.targetBranch)) throw new Error(`Branch inválida no ambiente ${key}`)
    result[key] = environment
  }
  return result
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`Lista ${field} inválida`)
  return [...new Set(value.map((item: string) => item.trim()).filter(Boolean))]
}
function optionalWebUrl(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('URL inválida')
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('URL inválida') }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL deve usar HTTP ou HTTPS')
  return value
}
function webOrigin(origin: string | undefined): string | undefined { return origin && /^https?:\/\//i.test(origin) ? origin : undefined }
function safeOrigin(origin: string | undefined): string | undefined {
  if (!origin || !/^https?:\/\//i.test(origin)) return origin
  try {
    const url = new URL(origin)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch { return undefined }
}
function validateAlias(value: string): void { if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(value)) throw new Error('Alias deve conter letras minúsculas, números, ponto, hífen ou sublinhado') }
function validateCompanions(repository: Repository, others: Repository[]): void {
  const ids = new Set(others.map((repo) => repo.id))
  for (const id of repository.environments.local.companionRepositoryIds ?? []) if (!ids.has(id)) throw new Error(`Repositório companheiro desconhecido: ${id}`)
}
function slug(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'repository' }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
