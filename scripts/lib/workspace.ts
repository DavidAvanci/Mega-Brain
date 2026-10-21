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
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { WORKTREES } from './env.ts'
import {
  activeRepositories,
  activeRepositoryCompanionGroup,
  activeRepositoryPath,
  assertRegisteredWorktree,
} from '../../server/repositories/catalog.ts'
import { currentBranch, defaultBranch, git, hasRef } from './git.ts'
import { installCommand, lockfilesMatch, resolvePackageManagerCommand } from './packageManager.ts'
import { readPlan } from './plan.ts'
import { diagnoseProjectEnvironment } from './project-environment.ts'
import { resolveProjectNode } from './project-node.ts'
import { slugify, taskJiraKey } from './task-id.ts'
import { diagnoseCompanionArtifacts, runConfiguredCompanionBuild } from './project-companions.ts'

export interface TaskInfo {
  id: string
  jiraKey?: string
  title: string
  type: 'fix' | 'feature'
  branch: string
}

export interface PreservedAttempt {
  id: string
  itemId: string
  repo: string
  status: 'running' | 'done' | 'failed' | 'blocked'
  startedAt: string
  finishedAt?: string
  model?: string
  timeoutMs?: number
  durationMs?: number
  costUsd?: number
  note?: string
  branch?: string
  worktree?: string
  commitBefore?: string
  commitAfter?: string
  environment?: string
  runtime?: {
    requirement: string
    source: string
    version: string
    execPath: string
    server?: { version: string; execPath: string }
    cli?: { name: string; execPath: string }
    warning?: string
  }
}

const ATTEMPTS_FILE = 'execution-attempts.json'

export function recordAttempt(wsPath: string, attempt: PreservedAttempt): void {
  const file = join(wsPath, ATTEMPTS_FILE)
  let attempts: PreservedAttempt[] = []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) attempts = parsed as PreservedAttempt[]
  } catch {}
  const index = attempts.findIndex((entry) => entry.id === attempt.id)
  if (index === -1) attempts.push(attempt)
  else attempts[index] = { ...attempts[index], ...attempt }
  writeFileSync(file, `${JSON.stringify(attempts, null, 2)}\n`)
}

export function readRequiredBases(wsPath: string, repo: string): string[] {
  const card = readCardRecord(join(wsPath, 'card.json'))
  const raw = card?.requiredBases ?? card?.bases
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const value = (raw as Record<string, unknown>)[repo]
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  return Array.isArray(value)
    ? value.filter((ref): ref is string => typeof ref === 'string' && Boolean(ref.trim())).map((ref) => ref.trim())
    : []
}

export function recordPreparedBases(wsPath: string, repo: string, resolved: string[]): void {
  const file = join(wsPath, 'card.json')
  const card = readCardRecord(file) ?? {}
  const current =
    card.preparedBases && typeof card.preparedBases === 'object' && !Array.isArray(card.preparedBases)
      ? (card.preparedBases as Record<string, unknown>)
      : {}
  card.preparedBases = { ...current, [repo]: { refs: resolved, preparedAt: new Date().toISOString() } }
  writeFileSync(file, `${JSON.stringify(card, null, 2)}\n`)
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
  const key = taskJiraKey(wsPath, plan)
  const id = key ?? slugify(folder)
  const branch = `${plan.type}/${key ? `${id}-` : ''}${slugify(title)}`.slice(0, 60).replace(/-+$/, '')
  return { id, jiraKey: key, title, type: plan.type, branch }
}

export function realRepoPath(repo: string): string {
  return activeRepositoryPath(repo)
}

export function repoLinks(wsPath: string): { name: string; path: string }[] {
  const linksRoot = existsSync(join(wsPath, 'repos')) ? join(wsPath, 'repos') : wsPath
  return readdirSync(linksRoot, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .flatMap((entry) => {
      try {
        const path = realpathSync(join(linksRoot, entry.name))
        if (!existsSync(join(path, '.git'))) return []
        assertRegisteredWorktree(entry.name, path)
        return [{ name: entry.name, path }]
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
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

// As dependências e a configuração local pertencem ao checkout original (master).
// As worktrees de tarefas só as referenciam para não duplicar installs ou credenciais.
export function linkProjectRuntimeFiles(real: string, worktree: string): void {
  const runtimeFiles = [
    ['node_modules', join(real, 'node_modules'), 'dir'],
    ['.env', join(real, existsSync(join(real, '.env.local')) ? '.env.local' : '.env'), 'file'],
  ] as const
  for (const [name, source, type] of runtimeFiles) {
    const target = join(worktree, name)
    if (!existsSync(source) || lstatSync(target, { throwIfNoEntry: false })) continue
    try {
      symlinkSync(realpathSync(source), target, type === 'dir' && process.platform === 'win32' ? 'junction' : type)
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
      prepareProjectDependencies(real, target, repo)
      ensureRepositoryCompanions(taskId, repo)
      prepareCompanionArtifactsSafely(taskId, repo, target)
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
  symlinkSync(worktree, link, process.platform === 'win32' ? 'junction' : 'dir')
  prepareProjectDependencies(real, worktree, repo)
  ensureRepositoryCompanions(taskId, repo)
  prepareCompanionArtifactsSafely(taskId, repo, worktree)
  return worktree
}

/** Brings explicitly declared migration/base refs into the card branch once. */
export function prepareRequiredBases(worktree: string, repo: string, refs: string[]): string[] {
  const resolved: string[] = []
  for (const requested of refs) {
    let ref = requested
    try {
      git(worktree, 'rev-parse', '--verify', '--quiet', ref)
    } catch {
      // A short branch name normally belongs to origin.  Do not silently use a
      // similarly named local branch from an unrelated task.
      const remote = requested.startsWith('origin/') ? requested : `origin/${requested}`
      try {
        git(worktree, 'rev-parse', '--verify', '--quiet', remote)
        ref = remote
      } catch {
        throw new Error(`${repo}: base obrigatória ausente: ${requested}`)
      }
    }
    const hash = git(worktree, 'rev-parse', ref)
    try {
      git(worktree, 'merge-base', '--is-ancestor', hash, 'HEAD')
    } catch {
      try {
        git(worktree, 'merge', '--no-edit', hash)
      } catch {
        const conflict = git(worktree, 'diff', '--name-only', '--diff-filter=U') || 'conflito de integração'
        try {
          git(worktree, 'merge', '--abort')
        } catch {}
        throw new Error(`${repo}: conflito ao integrar base obrigatória ${requested}: ${conflict}`)
      }
    }
    resolved.push(`${requested}@${hash}`)
  }
  return resolved
}

export function projectEnvironmentIssue(dir: string, repo?: string): string | null {
  const canonical = repo ? activeRepositoryPath(repo) : undefined
  return (
    diagnoseProjectEnvironment(dir, repo ?? dir, canonical).diagnostics.find((diagnostic) =>
      ['node-runtime-unavailable', 'package-json-invalid'].includes(diagnostic.code),
    )?.message ?? null
  )
}

function prepareCompanionArtifactsSafely(taskId: string, repo: string, worktree: string): void {
  try {
    prepareCompanionArtifacts(taskId, repo, worktree)
  } catch (error) {
    process.stderr.write(
      `${repo}: artefato companheiro indisponível; os checks poderão ficar ambientais: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }
}

/** Installs only in the task worktree; shared dependency links are removed before installation. */
export function prepareProjectDependencies(canonical: string, worktree: string, repo: string): void {
  if (!existsSync(join(worktree, 'package.json'))) return
  const config = activeRepositories().find((entry) => entry.alias.toLowerCase() === repo.toLowerCase())?.nodeRuntime
  const resolution = resolveProjectNode(worktree, {
    override: config?.override,
    policy:
      config?.policy ??
      (process.env.CHECKLIST_NODE_POLICY === 'same-major-fallback' ? 'same-major-fallback' : 'strict'),
    allowServerDefault: true,
  })
  if (resolution.status !== 'resolved' || !resolution.runtime?.project) {
    process.stderr.write(`${repo}: ${resolution.diagnostic ?? 'Node do projeto indisponível'}\n`)
    return
  }
  const modules = join(worktree, 'node_modules')
  const linked = isLink(modules)
  const canonicalRuntime = resolveProjectNode(canonical, {
    override: config?.override,
    policy: config?.policy ?? 'strict',
    allowServerDefault: true,
  })
  const runtimeCompatible =
    canonicalRuntime.status === 'resolved' &&
    canonicalRuntime.runtime?.project?.version === resolution.runtime.project.version
  const compatible = linked && lockfilesMatch(canonical, worktree) && runtimeCompatible
  if (compatible) return
  if (linked) unlinkSync(modules)
  if (existsSync(modules)) return
  const install = installCommand(worktree)
  const binDir = dirname(resolution.runtime.project.execPath)
  const env = { ...process.env, PATH: [binDir, process.env.PATH].filter(Boolean).join(delimiter) }
  try {
    const command = resolvePackageManagerCommand(install.cmd, install.args, resolution.runtime.project.execPath, env)
    execFileSync(command.cmd, command.args, { cwd: worktree, env, stdio: 'ignore', timeout: 15 * 60_000 })
  } catch (error) {
    process.stderr.write(
      `${install.cmd} ${install.args.join(' ')} falhou em ${repo}: ${error instanceof Error ? error.message : error}\n`,
    )
  }
}

export function checkoutTaskBranch(worktree: string, branch: string): void {
  if (currentBranch(worktree) !== 'HEAD') return
  if (hasRef(worktree, `refs/heads/${branch}`)) git(worktree, 'checkout', branch)
  else git(worktree, 'checkout', '-b', branch)
}

export function ensureRepositoryCompanions(taskId: string, repo: string): void {
  const group = activeRepositoryCompanionGroup(repo)
  for (const companion of group) {
    if (companion.alias.toLowerCase() === repo.toLowerCase()) continue
    const path = join(WORKTREES, taskId, 'repos', companion.alias)
    if (existsSync(path) || isLink(path)) continue
    try {
      addDetachedWorktree(activeRepositoryPath(companion.alias), path)
    } catch (error) {
      process.stderr.write(
        `${companion.alias}: não foi possível criar a worktree companheira: ${error instanceof Error ? error.message : error}\n`,
      )
    }
  }
}

const companionBuildsRun = new Set<string>()

export function prepareCompanionArtifacts(taskId: string, repo: string, worktree: string): void {
  const repositories = activeRepositories()
  const consumer = repositories.find((entry) => entry.alias.toLowerCase() === repo.toLowerCase())
  if (!consumer) return
  const companions = activeRepositoryCompanionGroup(repo)
    .filter((entry) => entry.id !== consumer.id)
    .map((entry) => ({ alias: entry.alias, path: join(WORKTREES, taskId, 'repos', entry.alias), entry }))
  const issues = diagnoseCompanionArtifacts(worktree, companions)
  for (const issue of issues) {
    if (issue.status === 'inconclusive') throw new Error(`${issue.reason} (${issue.target})`)
    if (!issue.companionPath || !issue.artifact)
      throw new Error(`${issue.reason}; configure uma relação de companion ou corrija o alias estático`)
    const companion = companions.find((entry) => entry.path === issue.companionPath)?.entry
    if (!companion) throw new Error(`${issue.reason}; repositório companheiro não cadastrado`)
    const build = consumer.companionBuilds?.find(
      (entry) =>
        entry.repositoryId === companion.id &&
        entry.artifacts.some(
          (path) => issue.artifact === path || issue.artifact?.startsWith(`${path.replace(/\/$/, '')}/`),
        ),
    )
    if (!build) throw new Error(`${issue.reason}; configure command e artifact autorizados para ${companion.alias}`)
    const canonical = activeRepositoryPath(companion.alias)
    const key = `${taskId}:${consumer.id}:${companion.id}:${build.artifacts.join(',')}`
    if (!companionBuildsRun.has(key)) {
      const companionWorktree = join(WORKTREES, taskId, 'repos', companion.alias)
      if (!existsSync(companionWorktree) || !isRegisteredWorktree(canonical, companionWorktree))
        throw new Error(`${issue.reason}; não há worktree gerenciada para ${companion.alias}`)
      const runtime = resolveProjectNode(companionWorktree, {
        override: companion.nodeRuntime?.override,
        policy: companion.nodeRuntime?.policy ?? 'strict',
        allowServerDefault: true,
      })
      if (runtime.status !== 'resolved' || !runtime.runtime?.project)
        throw new Error(`${companion.alias}: ${runtime.diagnostic ?? 'Node indisponível para build'}`)
      const result = runConfiguredCompanionBuild(consumer, companion, companionWorktree, issue.artifact, {
        nodePath: runtime.runtime.project.execPath,
      })
      if (result.status !== 'built') throw new Error(result.note)
      companionBuildsRun.add(key)
    }
    const target = join(issue.companionPath, issue.artifact)
    if (!existsSync(target)) throw new Error(`${issue.reason}; o build autorizado não produziu ${issue.artifact}`)
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
  // A failed or interrupted run is deliberately resumable.  Never remove an
  // existing item checkout merely because a new executor process started.
  if (existsSync(path) && isRegisteredWorktree(mainPath, path)) {
    if (currentBranch(path) !== branch)
      throw new Error(`${itemId}: worktree preservada está em ${currentBranch(path)}, não em ${branch}`)
    linkProjectRuntimeFiles(mainPath, path)
    return path
  }
  if (existsSync(path)) {
    throw new Error(
      `${itemId}: worktree residual não registrada em ${path}; preserve-a e corrija o registro Git antes de retomar`,
    )
  }
  mkdirSync(dirname(path), { recursive: true })
  if (hasRef(mainPath, `refs/heads/${branch}`)) git(mainPath, 'worktree', 'add', '--quiet', path, branch)
  else git(mainPath, 'worktree', 'add', '--quiet', '-b', branch, path, 'HEAD')
  const modules = join(mainPath, 'node_modules')
  if (existsSync(modules) && !existsSync(join(path, 'node_modules'))) {
    try {
      symlinkSync(realpathSync(modules), join(path, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch {}
  }
  linkProjectRuntimeFiles(mainPath, path)
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
  // `--ancestry-path` accounts for ordinary and merge commits alike.  The old
  // cherry-pick implementation attempted to apply merge commits without a
  // mainline parent and could report success before the card branch had them.
  try {
    git(mainPath, 'merge-base', '--is-ancestor', branch, 'HEAD')
    return { ok: true, commits: 0 }
  } catch {}
  const base = git(mainPath, 'merge-base', 'HEAD', branch)
  const commits = git(mainPath, 'rev-list', '--reverse', `${base}..${branch}`).split('\n').filter(Boolean)
  if (!commits.length) return { ok: true, commits: 0 }
  try {
    // Fast-forward keeps the simple case linear.  A real merge is used when
    // sibling items have advanced the card branch, so merge commits remain
    // valid Git history instead of being replayed as ordinary commits.
    try {
      git(mainPath, 'merge', '--ff-only', branch)
    } catch {
      git(mainPath, 'merge', '--no-ff', '--no-edit', branch)
    }
    return { ok: true, commits: commits.length }
  } catch (error) {
    const conflict = git(mainPath, 'diff', '--name-only', '--diff-filter=U') || 'conflito na integração'
    try {
      git(mainPath, 'merge', '--abort')
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
