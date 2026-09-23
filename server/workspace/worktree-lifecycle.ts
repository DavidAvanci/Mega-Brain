import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { stopDevEnv } from '../modules/dev-environments/dev-env'
import type { ProcessRunner } from '../process'
import { type CardData } from './card-record'
import { cardRepos, gitOut } from './worktree-inspector'

const PRODUCTION_TTL_MS = 24 * 60 * 60 * 1000

export function expiredInProduction(path: string, card: CardData, now = Date.now()): boolean {
  if (card.status !== 'producao') return false
  const file = join(path, 'card.json')
  return existsSync(file) && now - statSync(file).mtimeMs > PRODUCTION_TTL_MS
}

function isInside(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path)
  return Boolean(pathFromRoot) && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..'
}

function nestedGitWorktrees(root: string): string[] {
  if (!existsSync(root)) return []
  const found: string[] = []
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      else if (entry.isFile() && entry.name === '.git') found.push(path)
    }
  }
  visit(root)
  return found
}

/** Companion repositories are managed beside the card rather than linked inside it. */
function companionWorktrees(reposRoot: string): string[] {
  if (!existsSync(reposRoot)) return []
  return readdirSync(reposRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && statSync(join(reposRoot, entry.name, '.git'), { throwIfNoEntry: false })?.isFile(),
    )
    .map((entry) => join(reposRoot, entry.name))
}

export function cardWorktreeRepos(cardPath: string, worktreesRoot: string): { name: string; path: string }[] {
  const repos = new Map(cardRepos(cardPath).map((repo) => [repo.name, repo]))
  const managedRepos = join(worktreesRoot, basename(cardPath), 'repos')
  for (const path of companionWorktrees(managedRepos)) {
    const name = basename(path)
    if (!repos.has(name)) repos.set(name, { name, path })
  }
  return [...repos.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function hasMissingWorktreeRegistration(worktree: string): boolean {
  const metadata = join(worktree, '.git')
  try {
    const match = /^gitdir:\s*(.+)\s*$/i.exec(readFileSync(metadata, 'utf8'))
    if (!match) return false
    return !existsSync(resolve(dirname(metadata), match[1]))
  } catch {
    return false
  }
}

function removeCardWorktrees(
  cardPath: string,
  worktreesRoot: string,
  git: string | undefined,
  runner: ProcessRunner,
): void {
  const root = resolve(worktreesRoot)
  const mainRepos = new Set<string>()
  const worktrees = new Map<string, string>()
  for (const repo of cardRepos(cardPath)) worktrees.set(resolve(repo.path), repo.name)
  const taskRoot = join(root, basename(cardPath))
  for (const worktree of companionWorktrees(join(taskRoot, 'repos')))
    worktrees.set(resolve(worktree), basename(worktree))
  const itemRoot = join(taskRoot, 'items')
  for (const worktree of nestedGitWorktrees(itemRoot)) worktrees.set(resolve(worktree), basename(worktree))
  for (const [worktree, name] of worktrees) {
    // Only worktrees proven to be under the managed root are eligible for removal.
    if (!isInside(root, worktree)) continue
    try {
      const commonGitDir = gitOut(
        worktree,
        git,
        runner,
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
      ).trim()
      if (!commonGitDir) throw new Error('repositório Git inválido')
      const mainRepo = dirname(commonGitDir)
      gitOut(mainRepo, git, runner, 'worktree', 'remove', '--force', worktree)
      mainRepos.add(mainRepo)
    } catch (error) {
      if (hasMissingWorktreeRegistration(worktree)) {
        rmSync(worktree, { recursive: true, force: true })
        continue
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Não foi possível remover a worktree ${name}: ${reason}`)
    }
  }
  for (const mainRepo of mainRepos) gitOut(mainRepo, git, runner, 'worktree', 'prune')
  rmSync(itemRoot, { recursive: true, force: true })
}

export function deleteCard(
  cardPath: string,
  worktreesRoot: string,
  git: string | undefined,
  runner: ProcessRunner,
): void {
  stopDevEnv(cardPath)
  removeCardWorktrees(cardPath, worktreesRoot, git, runner)
  rmSync(cardPath, { recursive: true, force: true })
}
