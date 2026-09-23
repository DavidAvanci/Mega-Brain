import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { Repository, RepositoryRegistryFile } from '../../shared/domain/repositories'

export function repositoryCatalogFile(settingsFile = process.env.MEGA_BRAIN_SETTINGS_FILE?.trim() || join(homedir(), '.config', 'mega-brain', 'settings.json')): string {
  return join(dirname(settingsFile), 'repositories.json')
}

export function activeRepositories(file = repositoryCatalogFile()): Repository[] {
  let contents: string
  try {
    contents = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`Não foi possível ler o catálogo de repositórios: ${file}`, { cause: error })
  }
  let parsed: RepositoryRegistryFile
  try {
    parsed = JSON.parse(contents) as RepositoryRegistryFile
  } catch (error) {
    throw new Error('O catálogo de repositórios está inválido', { cause: error })
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.repositories)) {
    throw new Error('Versão do catálogo de repositórios não suportada')
  }
  return parsed.repositories.filter((repo) => repo?.active === true)
}

export function activeRepositoryPath(alias: string, file = repositoryCatalogFile()): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(alias)) throw new Error(`Alias de repositório inválido: ${alias}`)
  const repository = activeRepositories(file).find((repo) => repo.alias?.toLowerCase() === alias.toLowerCase())
  if (!repository) throw new Error(`Repositório não cadastrado ou inativo: ${alias}. Ative-o em Repositórios.`)
  if (!isAbsolute(repository.path)) throw new Error(`Caminho inválido no catálogo para ${alias}`)
  let path: string
  try {
    path = realpathSync(repository.path)
  } catch {
    throw new Error(`Checkout de ${alias} não está disponível: ${repository.path}`)
  }
  if (!existsSync(join(path, '.git'))) throw new Error(`Checkout Git de ${alias} não está disponível: ${path}`)
  return path
}

/** A card link may only target a worktree of the active checkout behind its alias. */
export function assertRegisteredWorktree(alias: string, worktree: string, file = repositoryCatalogFile()): void {
  const canonical = activeRepositoryPath(alias, file)
  let commonGitDir: string
  try {
    commonGitDir = execFileSync('git', ['-C', worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim()
  } catch {
    throw new Error(`Worktree inválida para ${alias}: ${worktree}`)
  }
  if (realpathSync(dirname(commonGitDir)) !== canonical) {
    throw new Error(`A worktree ${alias} não pertence ao checkout cadastrado em Repositórios`)
  }
}
