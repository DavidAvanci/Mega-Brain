import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { appendFileSync, mkdirSync, rmdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { TAKEAT, WORKTREES } from './env.ts'
import { currentBranch, defaultBranch, git, hasRef } from './git.ts'
import { JIRA_KEY } from './jira.ts'
import { installCommand } from './packageManager.ts'
import { readPlan } from './plan.ts'

export interface TaskInfo {
  id: string
  jiraKey?: string
  title: string
  type: 'fix' | 'feature'
  branch: string
}

export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'task'
}

function readCardRecord(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export function taskInfo(wsPath: string): TaskInfo {
  const folder = basename(wsPath)
  const plan = readPlan(wsPath)
  let title = folder
  const card = readCardRecord(join(wsPath, 'card.json'))
  if (typeof card?.title === 'string' && card.title) title = card.title
  const key = JIRA_KEY.test(folder)
    ? folder.toUpperCase()
    : plan.issue && JIRA_KEY.test(plan.issue)
      ? plan.issue.toUpperCase()
      : undefined
  const id = key ?? slugify(folder)
  const branch = `${plan.type}/${key ? `${id}-` : ''}${slugify(title)}`.slice(0, 60).replace(/-+$/, '')
  return { id, jiraKey: key, title, type: plan.type, branch }
}

export function realRepoPath(repo: string): string {
  for (const candidate of [join(TAKEAT, repo), join(TAKEAT, 'backend', repo), join(TAKEAT, 'clube', repo)]) {
    if (existsSync(join(candidate, '.git'))) return candidate
  }
  throw new Error(`Repo não encontrado em ~/takeat: ${repo}`)
}

export function repoLinks(wsPath: string): { name: string; path: string }[] {
  const linksRoot = existsSync(join(wsPath, 'repos')) ? join(wsPath, 'repos') : wsPath
  return readdirSync(linksRoot, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .flatMap((entry) => {
      try {
        const path = realpathSync(join(linksRoot, entry.name))
        return existsSync(join(path, '.git')) ? [{ name: entry.name, path }] : []
      } catch {
        return []
      }
    })
}

function canonicalPath(path: string): string {
  return resolveLink(path) ?? resolve(path)
}

function insideWorktrees(path: string): boolean {
  const rel = relative(canonicalPath(WORKTREES), canonicalPath(path))
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Paths registered by Git as linked worktrees (the first entry is the main checkout). */
export function registeredWorktreePaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .flatMap((line) => (line.startsWith('worktree ') ? [canonicalPath(line.slice('worktree '.length))] : []))
}

function isRegisteredWorktree(mainRepo: string, path: string): boolean {
  try {
    return registeredWorktreePaths(git(mainRepo, 'worktree', 'list', '--porcelain')).includes(canonicalPath(path))
  } catch {
    return false
  }
}

export function assertFeatureBranch(cwd: string, repo: string): void {
  const branch = currentBranch(cwd)
  if (branch === 'HEAD' || branch === defaultBranch(cwd)) {
    throw new Error(`${repo}: ${cwd} está em ${branch}, não numa feature branch`)
  }
}

function copyUntrackedEnv(real: string, worktree: string): void {
  for (const entry of readdirSync(real)) {
    if (!entry.startsWith('.env')) continue
    if (existsSync(join(worktree, entry))) continue
    try {
      git(real, 'ls-files', '--error-unmatch', entry)
      continue
    } catch {}
    try {
      writeFileSync(join(worktree, entry), readFileSync(join(real, entry)))
    } catch {}
  }
}

// As dependências e a configuração local pertencem ao checkout original (master).
// As worktrees de tarefas só as referenciam para não duplicar installs ou credenciais.
export function linkProjectRuntimeFiles(real: string, worktree: string): void {
  for (const [name, type] of [
    ['node_modules', 'dir'],
    ['.env', 'file'],
  ] as const) {
    const source = join(real, name)
    const target = join(worktree, name)
    if (!existsSync(source) || lstatSync(target, { throwIfNoEntry: false })) continue
    try {
      symlinkSync(realpathSync(source), target, type)
    } catch {}
  }
  excludeInjectedPaths(worktree)
}

// Layout atual é `<ws>/repos/<repo>`; workspaces antigos linkam em `<ws>/<repo>`.
export function repoLinkPath(wsPath: string, repo: string): string {
  const legacy = join(wsPath, repo)
  return existsSync(legacy) || isLink(legacy) ? legacy : join(wsPath, 'repos', repo)
}

interface WorktreeOrigin {
  ref: string
  hash: string
  repository: string
  createdAt: string
}

function recordWorktreeOrigin(wsPath: string, repo: string, origin: WorktreeOrigin): void {
  const file = join(wsPath, 'card.json')
  const card = readCardRecord(file) ?? {}
  const saved =
    card.worktrees && typeof card.worktrees === 'object' ? (card.worktrees as Record<string, WorktreeOrigin>) : {}
  card.worktrees = { ...saved, [repo]: origin }
  writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`)
}

export function ensureWorktree(wsPath: string, repo: string, taskId: string, branch: string): string {
  const link = repoLinkPath(wsPath, repo)
  const real = realRepoPath(repo)
  const worktree = join(WORKTREES, taskId, 'repos', repo)
  mkdirSync(dirname(link), { recursive: true })
  if (existsSync(link) || isLink(link)) {
    const target = resolveLink(link)
    // A directory below our worktree root is not sufficient proof that it is
    // usable. A moved/re-cloned repository can leave a .git file behind that
    // points at another worktree's metadata. Reusing it mixes two checkouts.
    if (target && insideWorktrees(target) && isRegisteredWorktree(real, target)) {
      assertFeatureBranch(target, repo)
      linkProjectRuntimeFiles(real, target)
      ensureBackendCompanions(taskId, repo)
      return target
    }
    if (!lstatSync(link).isSymbolicLink()) {
      throw new Error(
        `${repo}: ${link} não é uma worktree Git registrada — remova o resíduo antes de rodar o checklist`,
      )
    }
    unlinkSync(link)
  }
  mkdirSync(dirname(worktree), { recursive: true })
  if (existsSync(worktree) && !isRegisteredWorktree(real, worktree)) {
    throw new Error(`${repo}: worktree residual não registrada em ${worktree} — remova-a antes de recriar o card`)
  }
  if (!existsSync(worktree)) {
    git(real, 'fetch', 'origin')
    const base = `origin/${defaultBranch(real)}`
    const branches = git(real, 'branch', '--list', branch)
    const sourceRef = branches ? branch : base
    const sourceHash = git(real, 'rev-parse', sourceRef)
    if (branches) git(real, 'worktree', 'add', worktree, branch)
    else git(real, 'worktree', 'add', '-b', branch, worktree, base)
    recordWorktreeOrigin(wsPath, repo, {
      ref: sourceRef,
      hash: sourceHash,
      repository: real,
      createdAt: new Date().toISOString(),
    })
  }
  linkProjectRuntimeFiles(real, worktree)
  checkoutTaskBranch(worktree, branch)
  assertFeatureBranch(worktree, repo)
  symlinkSync(worktree, link)
  if (existsSync(join(worktree, 'package.json')) && !existsSync(join(worktree, 'node_modules'))) {
    const install = installCommand(worktree)
    try {
      execFileSync(install.cmd, install.args, { cwd: worktree, stdio: 'ignore', timeout: 15 * 60_000 })
    } catch (error) {
      process.stderr.write(
        `${install.cmd} ${install.args.join(' ')} falhou em ${repo}: ${error instanceof Error ? error.message : error}\n`,
      )
    }
  }
  ensureBackendCompanions(taskId, repo)
  return worktree
}

export function checkoutTaskBranch(worktree: string, branch: string): void {
  if (currentBranch(worktree) !== 'HEAD') return
  if (hasRef(worktree, `refs/heads/${branch}`)) git(worktree, 'checkout', branch)
  else git(worktree, 'checkout', '-b', branch)
}

export const BACKEND_STACK = ['api-garcom-digital', 'api-core', 'takeat-services']

// O dev-register do api-garcom-digital resolve as libs pelos irmãos ../api-core e ../takeat-services
export function ensureBackendCompanions(taskId: string, repo: string): void {
  if (!BACKEND_STACK.includes(repo)) return
  for (const companion of BACKEND_STACK) {
    if (companion === repo) continue
    const path = join(WORKTREES, taskId, 'repos', companion)
    if (existsSync(path) || isLink(path)) continue
    try {
      addDetachedWorktree(realRepoPath(companion), path)
    } catch (error) {
      process.stderr.write(
        `${companion}: não foi possível criar a worktree companion: ${error instanceof Error ? error.message : error}\n`,
      )
    }
  }
}

export function addDetachedWorktree(real: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  git(real, 'fetch', 'origin')
  git(real, 'worktree', 'add', '--detach', path, `origin/${defaultBranch(real)}`)
  linkProjectRuntimeFiles(real, path)
}

function resolveLink(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

export function mergeCardPrs(wsPath: string, env: 'staging' | 'master', prs: Record<string, string>): void {
  const file = join(wsPath, 'card.json')
  const card = readCardRecord(file)
  if (!card) return
  const currentPrs =
    card.prs && typeof card.prs === 'object' && !Array.isArray(card.prs) ? (card.prs as Record<string, unknown>) : {}
  const currentEnvironment =
    currentPrs[env] && typeof currentPrs[env] === 'object' && !Array.isArray(currentPrs[env])
      ? (currentPrs[env] as Record<string, string>)
      : {}
  card.prs = { ...currentPrs, [env]: { ...currentEnvironment, ...prs } }
  writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`)
}

// symlinkado para dentro da worktree do item: nunca é conteúdo do item, e um
// .gitignore com `node_modules/` não casa com o symlink
const INJECTED_PATHS = ['node_modules', '.env']

export function isInjected(path: string): boolean {
  return INJECTED_PATHS.some((injected) => path === injected || path.startsWith(`${injected}/`))
}

function unignoredInjectedPaths(cwd: string): string[] {
  return INJECTED_PATHS.filter((path) => {
    if (!lstatSync(join(cwd, path), { throwIfNoEntry: false })) return false
    try {
      git(cwd, 'check-ignore', '-q', '--', path)
      return false
    } catch {
      return true
    }
  })
}

function excludeInjectedPaths(cwd: string): void {
  const missing = unignoredInjectedPaths(cwd)
  if (!missing.length) return
  try {
    const file = resolve(cwd, git(cwd, 'rev-parse', '--git-path', 'info/exclude'))
    const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const lines = current.split('\n').map((line) => line.trim())
    const add = missing.filter((path) => !lines.includes(path))
    if (!add.length) return
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`)
  } catch {}
}

export function stageItemChanges(cwd: string): void {
  // `:(exclude)<path>` faz o git tratar o path como citado explicitamente e abortar se ele for
  // ignorado, então só exclui o que o .gitignore não pega sozinho: o symlink injetado
  const excludes = unignoredInjectedPaths(cwd).filter((path) =>
    lstatSync(join(cwd, path), { throwIfNoEntry: false })?.isSymbolicLink(),
  )
  git(cwd, 'add', '-A', '--', '.', ...excludes.map((path) => `:(exclude)${path}`))
}

function itemSlug(itemId: string): string {
  return itemId.replace(/[^A-Za-z0-9_-]/g, '_')
}

export function itemBranch(taskId: string, itemId: string): string {
  return `wip/${taskId}/${itemSlug(itemId)}`
}

export function itemWorktreePath(taskId: string, repo: string, itemId: string): string {
  return join(WORKTREES, taskId, 'items', itemSlug(itemId), repo)
}

export function ensureItemWorktree(mainPath: string, taskId: string, repo: string, itemId: string): string {
  const path = itemWorktreePath(taskId, repo, itemId)
  const branch = itemBranch(taskId, itemId)
  dropItemWorktree(mainPath, taskId, repo, itemId)
  mkdirSync(dirname(path), { recursive: true })
  git(mainPath, 'worktree', 'add', '--quiet', '-b', branch, path, 'HEAD')
  const modules = join(mainPath, 'node_modules')
  if (existsSync(modules) && !existsSync(join(path, 'node_modules'))) {
    try {
      symlinkSync(realpathSync(modules), join(path, 'node_modules'), 'dir')
    } catch {}
  }
  copyUntrackedEnv(mainPath, path)
  excludeInjectedPaths(path)
  return path
}

export function dropItemWorktree(mainPath: string, taskId: string, repo: string, itemId: string): void {
  const path = itemWorktreePath(taskId, repo, itemId)
  if (existsSync(path)) {
    try {
      git(mainPath, 'worktree', 'remove', '--force', path)
    } catch {}
    // sobra de run interrompido: o diretório existe sem estar registrado como worktree
    if (existsSync(path)) rmSync(path, { recursive: true, force: true })
  }
  git(mainPath, 'worktree', 'prune')
  const branch = itemBranch(taskId, itemId)
  if (hasRef(mainPath, `refs/heads/${branch}`)) {
    try {
      git(mainPath, 'branch', '-D', branch)
    } catch {}
  }
  for (let dir = dirname(path); insideWorktrees(dir); dir = dirname(dir)) {
    try {
      rmdirSync(dir)
    } catch {
      break
    }
  }
}

export interface Integration {
  ok: boolean
  commits: number
  conflict?: string
}

export function integrateItemBranch(mainPath: string, branch: string): Integration {
  const base = git(mainPath, 'merge-base', 'HEAD', branch)
  const commits = git(mainPath, 'rev-list', '--reverse', `${base}..${branch}`).split('\n').filter(Boolean)
  if (!commits.length) return { ok: true, commits: 0 }
  try {
    git(mainPath, 'cherry-pick', ...commits)
    return { ok: true, commits: commits.length }
  } catch (error) {
    const conflict = git(mainPath, 'diff', '--name-only', '--diff-filter=U') || 'conflito no cherry-pick'
    try {
      git(mainPath, 'cherry-pick', '--abort')
    } catch {}
    return { ok: false, commits: commits.length, conflict: conflict.split('\n').filter(Boolean).join(', ') }
  }
}

export function orphanItemBranches(mainPath: string, taskId: string): { itemId: string; branch: string }[] {
  const prefix = `wip/${taskId}/`
  let listed = ''
  try {
    listed = git(mainPath, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}*`)
  } catch {
    return []
  }
  return listed
    .split('\n')
    .filter(Boolean)
    .filter((branch) => Number(git(mainPath, 'rev-list', '--count', `HEAD..${branch}`)) > 0)
    .map((branch) => ({ itemId: branch.slice(prefix.length), branch }))
}
