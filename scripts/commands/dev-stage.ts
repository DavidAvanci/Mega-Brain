import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { TASK_CHECKLIST_FILE } from '../../shared/domain/task-checklist.ts'
import { readTaskChecklist } from '../../shared/storage/task-checklist.ts'
import { delimiter, dirname, join, posix, resolve } from 'node:path'
import { runsAsCommand, WORKTREES } from '../lib/env.ts'
import {
  appendChecklistRepairsDetailed,
  markItem,
  matchesPattern,
  parseChecklist,
  pendingRequires,
  resetUnfinished,
  type Item,
} from '../lib/checklist.ts'
import { CmdError, changedFiles, defaultBranch, git, hasRef } from '../lib/git.ts'
import { activity, finish, scriptActivity } from '../lib/log.ts'
import { readPlan } from '../lib/plan.ts'
import { preflight } from '../lib/preflight.ts'
import { formatDuration, runChecklist, type ItemOutcome } from '../lib/scheduler.ts'
import { agentCliRuntime, runClaudeItem } from '../lib/executor.ts'
import { resolveProjectNode } from '../lib/project-node.ts'
import { activeRepositories } from '../../server/repositories/catalog.ts'
import { discoverVerificationProfile, loadValidVerificationProfile } from '../lib/verification-profile.ts'
import { runProjectCommand } from '../lib/project-command.ts'
import { cardChangeScope } from '../lib/card-change-scope.ts'
import { formatProjectFiles } from '../lib/project-format.ts'
import { runVerificationChecks } from '../lib/verification-runner.ts'
import { megaBrainPrompt } from '../lib/prompts.ts'
import { taskItemPrompt } from '../lib/task-item-prompt.ts'
import { parseVerificationReport, verificationChecksSucceeded, verificationChecksSummary } from '../lib/verification-report.ts'
import { applyProjectCheckRelevance, verificationPrompt } from '../lib/verification-prompt.ts'
import { isRepairableCheck } from '../../shared/domain/verification.ts'
import {
  assertFeatureBranch,
  dropItemWorktree,
  ensureItemWorktree,
  ensureWorktree,
  integrateItemBranch,
  isInjected,
  itemBranch,
  itemWorktreePath,
  type PreservedAttempt,
  orphanItemBranches,
  prepareRequiredBases,
  projectEnvironmentIssue,
  recordPreparedBases,
  readRequiredBases,
  recordAttempt,
  stageItemChanges,
  realRepoPath,
  repoLinkPath,
  taskInfo,
} from '../lib/workspace.ts'

const wsPath = resolve(process.argv[2] ?? process.cwd())
const file = join(wsPath, TASK_CHECKLIST_FILE)

function repoPath(repo: string): string {
  return repoLinkPath(wsPath, repo)
}

const AGENT = {
  model: process.env.CHECKLIST_MODEL ?? 'fable',
  effort: process.env.CHECKLIST_EFFORT ?? 'low',
  tools: 'Read,Edit,Write,Grep,Glob,Bash',
}

function positiveInt(value: string | undefined, fallback: number, label: string): number {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} deve ser um inteiro positivo`)
  return parsed
}

function redactNote(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*=\s*[^\s]+/gi, '$1=[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted AWS key]')
    .slice(0, 4000)
}

function limitsFor(item: Item): { timeoutMs: number; maxAttempts: number } {
  const timeoutMinutes =
    item.timeoutMinutes ?? positiveInt(process.env.CHECKLIST_TIMEOUT_MINUTES, 20, 'CHECKLIST_TIMEOUT_MINUTES')
  const maxAttempts = item.maxAttempts ?? positiveInt(process.env.CHECKLIST_MAX_ATTEMPTS, 3, 'CHECKLIST_MAX_ATTEMPTS')
  return { timeoutMs: timeoutMinutes * 60_000, maxAttempts }
}

function buildPrompt(
  item: Item,
  planRaw: string,
  runtime?: { version: string; execPath: string; warning?: string },
): string {
  const repositories = [...new Set(parseChecklist(readFileSync(file, 'utf8')).map((entry) => entry.repo))]
    .filter((repo) => existsSync(repoPath(repo)))
    .map((repo) => ({ repo, path: repoPath(repo) }))
  const profile = verificationProfiles.get(item.repo)
  const command =
    item.origin === 'verification-repair' &&
    item.repair &&
    item.repair.profileFingerprint === profile?.fingerprint
      ? profile.commands.find((entry) => entry.id === item.repair?.checkId)
      : undefined
  return taskItemPrompt(
    item,
    megaBrainPrompt('taskItem'),
    repositories,
    planRaw,
    runtime,
    command && item.repair
      ? { id: command.id, argv: command.argv, diagnostics: item.repair.diagnostics ?? [] }
      : undefined,
  )
}

const itemCwd = new Map<string, string>()
const unrecovered = new Map<string, string>()
const repoLocks = new Map<string, Promise<unknown>>()
const verificationProfiles = new Map<string, ReturnType<typeof discoverVerificationProfile>>()

function withRepoLock<T>(repo: string, fn: () => T): Promise<T> {
  const previous = repoLocks.get(repo) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  repoLocks.set(
    repo,
    next.catch(() => undefined),
  )
  return next
}

function commitMessage(task: ReturnType<typeof taskInfo>, item: Item): string[] {
  const subject = item.title.charAt(0).toLowerCase() + item.title.slice(1)
  const args = ['commit', '--no-verify', '-m', `${task.type === 'fix' ? 'fix' : 'feat'}: ${subject}`.slice(0, 100)]
  if (task.jiraKey) args.push('-m', `Refs: ${task.jiraKey}`)
  return args
}

async function commitItem(
  task: ReturnType<typeof taskInfo>,
  item: Item,
  worktreeId = item.id,
): Promise<ItemOutcome | null> {
  const cwd = itemCwd.get(item.id)
  const main = repoPath(item.repo)
  const branch = itemBranch(task.id, worktreeId)
  const discard = () => {
    itemCwd.delete(item.id)
    dropItemWorktree(main, task.id, item.repo, worktreeId)
  }
  if (!cwd) return null
  const touched = changedFiles(cwd).filter((path) => !isInjected(path))
  if (!touched.length) {
    const integration = await withRepoLock(item.repo, () => integrateItemBranch(main, branch))
    if (!integration.ok) {
      unrecovered.set(item.id, branch)
      return {
        status: 'failed',
        note: `Trabalho preservado em \`${branch}\`; conflito de integração: ${integration.conflict}.`,
      }
    }
    discard()
    return integration.commits
      ? { status: 'done', note: `${integration.commits} commit(s) existentes foram integrados.` }
      : null
  }

  stageItemChanges(cwd)
  try {
    git(cwd, ...commitMessage(task, item))
  } catch (error) {
    const output = error instanceof CmdError ? error.raw : String(error)
    return { status: 'failed', note: `Commit falhou: ${output.split('\n').slice(-3).join(' | ')}` }
  }

  const integration = await withRepoLock(item.repo, () => {
    assertFeatureBranch(main, item.repo)
    return integrateItemBranch(main, branch)
  })
  if (!integration.ok) {
    unrecovered.set(item.id, branch)
    return {
      status: 'failed',
      note: `Trabalho preservado em \`${branch}\` (${integration.commits} commit(s)) — a integração para \`${task.branch}\` conflitou em: ${integration.conflict}. Nada foi perdido; resolva o conflito ou rode de novo e o scheduler tenta reaplicar antes de gastar agente.`,
    }
  }

  discard()
  const widen = item.files.length
    ? touched.filter((path) => !item.files.some((pattern) => matchesPattern(path, pattern)))
    : []
  return {
    status: 'done',
    note: widen.length ? `Arquivos fora do \`files\` declarado (acrescentados ao checklist): ${widen.join(', ')}` : '',
    widen,
  }
}

function cardChangedScope(repo: string) {
  const cwd = repoPath(repo)
  let base: string
  try {
    const card: unknown = JSON.parse(readFileSync(join(wsPath, 'card.json'), 'utf8'))
    const origins = card && typeof card === 'object' ? (card as Record<string, unknown>).worktrees : undefined
    const origin = origins && typeof origins === 'object' ? (origins as Record<string, unknown>)[repo] : undefined
    const hash = origin && typeof origin === 'object' ? (origin as Record<string, unknown>).hash : undefined
    if (typeof hash !== 'string' || !hash.trim()) throw new Error('base original ausente')
    base = git(cwd, 'rev-parse', '--verify', `${hash}^{commit}`)
  } catch {
    const remoteDefault = `origin/${defaultBranch(cwd)}`
    base = git(cwd, 'merge-base', 'HEAD', remoteDefault)
  }
  return cardChangeScope(cwd, base)
}

function cardChangedFiles(repo: string): string[] {
  const scope = cardChangedScope(repo)
  return [...new Set([...scope.added, ...scope.modified, ...scope.renamed.map((entry) => entry.to)])].sort()
}

function existsInRef(real: string, ref: string, path: string): boolean {
  if (path === '.') return true
  try {
    git(real, 'cat-file', '-e', `${ref}:${path}`)
    return true
  } catch {
    return false
  }
}

function patternExists(repo: string, pattern: string, branch: string): boolean {
  const clean = pattern.replace(/\/?\*+$/, '')
  const link = repoPath(repo)
  if (existsSync(link)) {
    const path = join(link, clean)
    return existsSync(path) || existsSync(dirname(path))
  }
  // Worktree ainda não preparada: conferir na ref de onde ela vai nascer
  const real = realRepoPath(repo)
  const ref = hasRef(real, `refs/heads/${branch}`) ? branch : `origin/${defaultBranch(real)}`
  return existsInRef(real, ref, clean) || existsInRef(real, ref, posix.dirname(clean))
}

function reportPreflight(items: Item[], branch: string): boolean {
  const repositoryIssues = new Map<string, string>()
  const issues = preflight(items, {
    repoExists: (repo) => {
      try {
        realRepoPath(repo)
        return true
      } catch (error) {
        repositoryIssues.set(repo, error instanceof Error ? error.message : String(error))
        return false
      }
    },
    repoIssue: (repo) => repositoryIssues.get(repo),
    pathExists: (repo, pattern) => patternExists(repo, pattern, branch),
  })
  for (const issue of issues) {
    activity('Preflight', `${issue.level === 'error' ? 'Erro' : 'Aviso'} — ${issue.where}: ${issue.message}`)
  }
  const errors = issues.filter((issue) => issue.level === 'error')
  if (!errors.length) return true
  finish(
    false,
    [
      `Preflight reprovou o TASK-CHECKLIST.json (${errors.length} erro(s)) — nenhum agente foi gasto:`,
      ...errors.map((issue) => `${issue.where}: ${issue.message}`),
      'Corrija o checklist e rode de novo (ou CHECKLIST_SKIP_PREFLIGHT=1 para ignorar).',
    ].join('\n'),
  )
  return false
}

function recoverOrphans(task: ReturnType<typeof taskInfo>, repos: string[]): void {
  for (const repo of repos) {
    const main = repoPath(repo)
    for (const { branch } of orphanItemBranches(main, task.id)) {
      const items = parseChecklist(readFileSync(file, 'utf8'))
      const item = items.find((entry) => itemBranch(task.id, entry.id) === branch)
      const label = item?.id ?? branch
      const preserved = itemWorktreePath(task.id, repo, branch.slice(`wip/${task.id}/`.length))
      if (existsSync(preserved) && changedFiles(preserved).some((path) => !isInjected(path))) {
        activity('Recuperar', `${label}: alterações parciais preservadas na worktree; continuando o item`)
        continue
      }
      activity('Recuperar', `${label}: reaplicando trabalho preservado em ${branch}`)
      const integration = integrateItemBranch(main, branch)
      if (!integration.ok) {
        if (item) unrecovered.set(item.id, branch)
        activity('Recuperar', `${label}: ainda conflita em ${integration.conflict}`)
        continue
      }
      dropItemWorktree(main, task.id, repo, branch.slice(`wip/${task.id}/`.length))
      if (item) {
        markItem(
          file,
          item,
          'done',
          `Recuperado do run anterior: ${integration.commits} commit(s) de \`${branch}\` reaplicados sem custo de agente.`,
        )
      }
      activity('Recuperar', `${label}: integrado em ${task.branch}`)
    }
  }
}

export async function runDevStage(): Promise<void> {
  if (!readTaskChecklist(wsPath)) {
    finish(false, 'TASK-CHECKLIST.json não encontrado no workspace')
    return
  }
  const task = taskInfo(wsPath)
  const plan = readPlan(wsPath)
  const parsed = parseChecklist(readFileSync(file, 'utf8'))
  if (!process.env.CHECKLIST_SKIP_PREFLIGHT && !reportPreflight(parsed, task.branch)) {
    process.exit(1)
  }

  const repos = [...new Set(parsed.map((item) => item.repo).filter(Boolean))]
  const skippedRepos = new Map<string, string>()
  const prepared: string[] = []
  for (const repo of repos) {
    activity('Worktree', `Preparando ${repo}`)
    try {
      const worktree = ensureWorktree(wsPath, repo, task.id, task.branch)
      const bases = prepareRequiredBases(worktree, repo, readRequiredBases(wsPath, repo))
      if (bases.length) recordPreparedBases(wsPath, repo, bases)
      const environment = projectEnvironmentIssue(worktree, repo)
      if (environment) throw new Error(environment)
      const runtimeConfig = activeRepositories().find(
        (entry) => entry.alias.toLowerCase() === repo.toLowerCase(),
      )?.nodeRuntime
      const profile = loadValidVerificationProfile(join(wsPath, `verification-profile-${repo}.json`), worktree, repo, {
        override: runtimeConfig?.override,
        policy: runtimeConfig?.policy,
      })
      verificationProfiles.set(repo, profile)
      if (bases.length) activity('Worktree', `${repo}: base obrigatória conferida (${bases.join(', ')})`)
      prepared.push(repo)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      skippedRepos.set(repo, reason)
      activity('Worktree', `Pulando ${repo}: ${reason}`)
    }
  }

  const dirty = prepared
    .map((repo) => ({ repo, files: changedFiles(repoPath(repo)) }))
    .filter((entry) => entry.files.length)
  if (dirty.length) {
    finish(
      false,
      [
        'Worktree de integração suja — a integração dos itens seria recusada. Nenhum agente foi gasto:',
        ...dirty.map((entry) => `${entry.repo}: ${entry.files.join(', ')}`),
        'Commite ou descarte essas alterações e rode de novo.',
      ].join('\n'),
    )
    process.exit(1)
  }

  const missingRequirements = parsed.flatMap((item) =>
    item.repo && prepared.includes(item.repo)
      ? pendingRequires(item, parsed, (pattern) =>
          existsSync(join(repoPath(item.repo), pattern.replace(/\/?\*+$/, ''))),
        ).map((pattern) => `${item.id}: ${pattern}`)
      : [],
  )
  if (missingRequirements.length) {
    finish(
      false,
      [
        'Pré-condições ausentes na worktree já preparada — nenhum agente foi gasto:',
        ...missingRequirements.map((entry) => `requires: ${entry}`),
      ].join('\n'),
    )
    process.exit(1)
  }

  resetUnfinished(file)
  recoverOrphans(task, prepared)

  const runExecutorWave = () =>
    runChecklist({
      file,
      max: 4,
      execute: async (item) => {
        const skipReason = skippedRepos.get(item.repo)
        if (skipReason)
          return { status: 'blocked' as const, note: `Repositório "${item.repo}" indisponível: ${skipReason}` }
        if (!item.repo || !existsSync(repoPath(item.repo))) {
          return { status: 'blocked' as const, note: `Repo desconhecido: ${item.repo || '(sem repo)'}` }
        }
        if (item.repair && item.origin === 'verification-repair') {
          const profile = verificationProfiles.get(item.repo)
          const authorized = profile?.commands.some((command) => command.id === item.repair?.checkId)
          if (!profile || profile.fingerprint !== item.repair.profileFingerprint || !authorized)
            return {
              status: 'blocked' as const,
              note: 'Reparo bloqueado antes do agente: perfil alterado ou checkId sem autorização atual.',
            }
        }
        const pending = unrecovered.get(item.id)
        if (pending) {
          return {
            status: 'blocked' as const,
            note: `Não re-executado: já existe trabalho commitado em \`${pending}\` que não integrou. Resolva o cherry-pick ou apague a branch para refazer o item do zero.`,
          }
        }
        let cwd: string
        try {
          cwd = ensureItemWorktree(repoPath(item.repo), task.id, item.repo, item.id)
        } catch (error) {
          return {
            status: 'failed' as const,
            note: `Falha ao criar a worktree do item: ${error instanceof Error ? error.message : error}`,
          }
        }
        itemCwd.set(item.id, cwd)
        const runtimeConfig = activeRepositories().find(
          (entry) => entry.alias.toLowerCase() === item.repo.toLowerCase(),
        )?.nodeRuntime
        const nodeResolution = resolveProjectNode(cwd, {
          override: runtimeConfig?.override,
          policy:
            runtimeConfig?.policy ??
            (process.env.CHECKLIST_NODE_POLICY === 'same-major-fallback' ? 'same-major-fallback' : 'strict'),
          allowServerDefault: true,
        })
        if (nodeResolution.status !== 'resolved' || !nodeResolution.runtime?.project)
          return { status: 'blocked' as const, note: nodeResolution.diagnostic ?? 'Node do projeto indisponível' }
        const projectNode = nodeResolution.runtime.project
        const projectEnv = {
          ...process.env,
          PATH: [dirname(projectNode.execPath), process.env.PATH].filter(Boolean).join(delimiter),
          MEGA_BRAIN_PROJECT_NODE: projectNode.execPath,
        }
        const limits = limitsFor(item)
        let previousAttempts = 0
        let pausedAttempt: PreservedAttempt | undefined
        try {
          const saved: unknown = JSON.parse(readFileSync(join(wsPath, 'execution-attempts.json'), 'utf8'))
          if (Array.isArray(saved)) {
            const attempts = saved.filter((entry: PreservedAttempt) => entry.itemId === item.id)
            if (process.env.MEGA_BRAIN_RESUMING_STAGE === '1')
              pausedAttempt = attempts.findLast((entry: PreservedAttempt) => entry.status === 'running')
            previousAttempts = attempts.filter((entry) => entry !== pausedAttempt).length
          }
        } catch {}
        if (previousAttempts >= limits.maxAttempts) {
          return {
            status: 'blocked' as const,
            note: `Teto de ${limits.maxAttempts} tentativas atingido; trabalho salvo em \`${itemBranch(task.id, item.id)}\`. Corrija a causa ou divida o item antes de retomar.`,
          }
        }
        const attemptId = pausedAttempt?.id ?? `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const startedAt = pausedAttempt?.startedAt ?? new Date().toISOString()
        recordAttempt(wsPath, {
          id: attemptId,
          itemId: item.id,
          repo: item.repo,
          status: 'running',
          startedAt,
          model: AGENT.model,
          timeoutMs: limits.timeoutMs,
          branch: itemBranch(task.id, item.id),
          worktree: cwd,
          commitBefore: git(cwd, 'rev-parse', 'HEAD'),
          environment: process.version,
          runtime: {
            requirement: nodeResolution.runtime.requirement.value ?? 'server-default',
            source: nodeResolution.runtime.requirement.source,
            version: projectNode.version,
            execPath: projectNode.execPath,
            server: { version: process.version, execPath: process.execPath },
            cli: agentCliRuntime(),
            warning: nodeResolution.runtime.warning,
          },
        })
        const result = await runClaudeItem({
          cwd,
          prompt: buildPrompt(item, plan.raw, { ...projectNode, warning: nodeResolution.runtime.warning }),
          model: AGENT.model,
          effort: AGENT.effort,
          tools: AGENT.tools,
          timeoutMs: limits.timeoutMs,
          env: projectEnv,
          role: item.repair && item.origin === 'verification-repair' ? 'repair' : 'executor',
        })
        recordAttempt(wsPath, {
          id: attemptId,
          itemId: item.id,
          repo: item.repo,
          status: result.status,
          startedAt,
          finishedAt: new Date().toISOString(),
          model: AGENT.model,
          timeoutMs: limits.timeoutMs,
          durationMs: result.durationMs,
          costUsd: result.costUsd,
          note: result.note,
          branch: itemBranch(task.id, item.id),
          worktree: cwd,
          commitAfter: git(cwd, 'rev-parse', 'HEAD'),
          environment: process.version,
          runtime: {
            requirement: nodeResolution.runtime.requirement.value ?? 'server-default',
            source: nodeResolution.runtime.requirement.source,
            version: projectNode.version,
            execPath: projectNode.execPath,
            server: { version: process.version, execPath: process.execPath },
            cli: agentCliRuntime(),
            warning: nodeResolution.runtime.warning,
          },
        })
        return result
      },
      afterDone: async (item) => {
        if (item.repair && item.origin === 'verification-repair') {
          const profile = verificationProfiles.get(item.repo)
          const check = profile?.commands.find((command) => command.id === item.repair?.checkId)
          const cwd = itemCwd.get(item.id)
          if (
            !profile ||
            profile.fingerprint !== item.repair.profileFingerprint ||
            !check ||
            !cwd ||
            !profile.runtime.project
          )
            return {
              status: 'blocked' as const,
              note: 'Reparo sem perfil de verificação autorizado ou checkId inválido; a alteração não foi integrada.',
            }
          const touched = changedFiles(cwd).filter((path) => !isInjected(path))
          const checkFiles = touched.filter(
            (path) => !item.files.length || item.files.some((pattern) => matchesPattern(path, pattern)),
          )
          if (!checkFiles.length)
            return {
              status: 'blocked' as const,
              note: 'Reparo sem arquivo alterado dentro do escopo autorizado; a alteração não foi integrada.',
            }
          const node = profile.runtime.project
          const result = await runProjectCommand(
            {
              id: check.id,
              argv: check.scope === 'project' ? check.argv : [...check.argv, ...checkFiles],
              cwd,
              timeoutMs: check.timeoutMs,
              recordFile: join(wsPath, 'project-command-runs.jsonl'),
            },
            node,
          )
          if (result.status !== 'passed')
            return {
              status:
                result.status === 'timeout' || result.status === 'cancelled'
                  ? ('blocked' as const)
                  : ('failed' as const),
              note: `Check obrigatório ${check.id} não passou (${result.status}). ${result.stderr.slice(-1000)}`,
            }
        }
        return commitItem(task, item)
      },
    })
  let totalTaskCost = 0
  let taskCostReported = false
  let totalTaskDuration = 0
  const waveFailures: { id: string; note: string }[] = []
  const executeWave = async () => {
    const result = await runExecutorWave()
    totalTaskCost += result.costUsd
    taskCostReported ||= result.costReported
    totalTaskDuration += result.durationMs
    waveFailures.push(...result.failures)
    return result
  }
  await executeWave()

  const maxRepairWaves = positiveInt(
    process.env.CHECKLIST_MAX_VERIFICATION_WAVES,
    5,
    'CHECKLIST_MAX_VERIFICATION_WAVES',
  )
  let repairWaves = 0
  let verificationDuration = 0
  let verificationAgentDuration = 0
  let verificationAgentCost = 0
  let verificationAgentCostReported = false
  let verificationOk = true
  let verificationSummary = 'nenhuma rodada executada'
  const verificationEnabled = true
  for (let round = 1; verificationEnabled; round++) {
    for (const repo of repos) {
      try {
        const runtimeConfig = activeRepositories().find(
          (entry) => entry.alias.toLowerCase() === repo.toLowerCase(),
        )?.nodeRuntime
        const profile = loadValidVerificationProfile(
          join(wsPath, `verification-profile-${repo}.json`),
          repoPath(repo),
          repo,
          { override: runtimeConfig?.override, policy: runtimeConfig?.policy },
        )
        verificationProfiles.set(repo, profile)
      } catch {
        verificationProfiles.delete(repo)
      }
    }
    scriptActivity('Formatando arquivos...')
    const formatted = await formatCardFiles(round)
    scriptActivity()
    if (!formatted.ok) {
      verificationOk = false
      verificationSummary = formatted.summary
      break
    }
    const reportPath = join(wsPath, `verification-round-${round}.json`)
    let projects: { repo: string; path: string; baseRef: string; files: string[]; renamed: { from: string; to: string }[] }[]
    try {
      projects = repos.map((repo) => {
        const scope = cardChangedScope(repo)
        return {
          repo,
          path: realRepoPath(repo),
          baseRef: scope.base,
          files: [...new Set([...scope.added, ...scope.modified, ...scope.renamed.map((entry) => entry.to)])].sort(),
          renamed: scope.renamed,
        }
      })
    } catch (error) {
      verificationOk = false
      verificationSummary = `Não foi possível identificar os arquivos alterados pelo card: ${error instanceof Error ? error.message : error}`
      break
    }
    activity(
      'Verificação',
      `Rodada ${round}: checks por arquivo e scripts integrais em ${projects.length} projeto(s)`,
    )
    const startedAt = Date.now()
    let checks = await runVerificationChecks({
      projects,
      profiles: verificationProfiles,
      round,
      baselineRoot: join(realpathSync(WORKTREES), task.id, 'baselines'),
      recordFile: join(wsPath, 'project-command-runs.jsonl'),
    })
    const previousChecks = (() => {
      if (round <= 1) return []
      try {
        const raw: unknown = JSON.parse(readFileSync(join(wsPath, `verification-round-${round - 1}.json`), 'utf8'))
        if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).profiles)) return []
        const record = raw as Record<string, unknown>
        const historicalProfiles = new Map(verificationProfiles)
        for (const entry of record.profiles as unknown[]) {
          if (!entry || typeof entry !== 'object') continue
          const historical = entry as Record<string, unknown>
          if (typeof historical.repo !== 'string' || typeof historical.fingerprint !== 'string') continue
          const current = verificationProfiles.get(historical.repo)
          if (current)
            historicalProfiles.set(historical.repo, {
              ...current,
              fingerprint: historical.fingerprint,
              commands: current.commands,
            })
        }
        const previous = parseVerificationReport(raw, { profiles: historicalProfiles, round: round - 1 })
        return previous.checks
      } catch { return [] }
    })()
    const reviewer = await runClaudeItem({
      cwd: wsPath,
      prompt: verificationPrompt({
        round,
        projects,
        profiles: verificationProfiles,
        checks,
        previousChecks,
        waveNotes: waveFailures.slice(-100).map((entry) => ({
          id: entry.id,
          state: parseChecklist(readFileSync(file, 'utf8')).find((item) => item.id === entry.id)?.state ?? 'failed',
          note: entry.note,
        })),
      }),
      model: process.env.CHECKLIST_VERIFICATION_MODEL ?? AGENT.model,
      effort: process.env.CHECKLIST_VERIFICATION_EFFORT ?? AGENT.effort,
      tools: 'Read,Grep,Glob',
      timeoutMs: positiveInt(process.env.CHECKLIST_VERIFICATION_TIMEOUT_MINUTES, 60, 'CHECKLIST_VERIFICATION_TIMEOUT_MINUTES') * 60_000,
      role: 'verification',
    })
    verificationAgentDuration += reviewer.durationMs ?? 0
    verificationAgentCost += reviewer.costUsd ?? 0
    verificationAgentCostReported ||= reviewer.costUsd !== undefined
    const pendingProjectChecks = checks.filter((check) => check.relevance?.result === 'pending').length
    if (reviewer.status === 'done') checks = applyProjectCheckRelevance(checks, reviewer.note)
    const unresolvedProjectChecks = checks.filter((check) => check.relevance?.result === 'pending').length
    const reviewerNote = redactNote(reviewer.status === 'done'
      ? pendingProjectChecks
        ? unresolvedProjectChecks
          ? 'A análise não classificou todos os checks integrais; os pendentes continuam bloqueando.'
          : 'Análise de relevância aplicada aos checks integrais.'
        : reviewer.note
      : `Verificador indisponível (${reviewer.status}): ${reviewer.note}`)
    verificationDuration += Date.now() - startedAt
    const repairs = checks.filter(isRepairableCheck)
    let changes = { created: 0, reused: 0, stalled: 0 }
    if (repairs.length && repairWaves < maxRepairWaves) {
      try {
        changes = appendChecklistRepairsDetailed(file, repairs.map((check) => {
          const profile = verificationProfiles.get(check.repo)
          const projectScope = check.relevance?.result === 'relevant' && profile?.commands.find((entry) => entry.id === check.commandId)?.scope === 'project'
          const files = projectScope ? [] : check.files ?? []
          const fingerprint = createHash('sha256')
            .update([check.repo, check.commandId ?? check.id, ...files.slice().sort(), ...(check.diagnostics ?? []).map((diagnostic) => `${diagnostic.rule}:${diagnostic.message}`).sort()].join('\n'))
            .digest('hex')
          return {
            repo: check.repo,
            check: check.commandId ?? check.id,
            summary: check.summary,
            task: projectScope ? `Corrigir falhas relevantes de ${check.name} no projeto ${check.repo}` : `Corrigir ${check.name} nos arquivos ${files.join(', ')}`,
            files,
            fingerprint,
            checkId: check.commandId,
            profileFingerprint: profile?.fingerprint,
            wave: round,
            diagnostics: check.diagnostics,
          }
        }))
      } catch (error) {
        changes.stalled = 1
        verificationSummary = `Reparo sem progresso: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    const statusCounts = Object.fromEntries(['passed', 'failed', 'skipped', 'environment', 'inconclusive', 'ignored'].map((status) => [status, checks.filter((check) => check.status === status).length])) as Record<'passed' | 'failed' | 'skipped' | 'environment' | 'inconclusive' | 'ignored', number>
    const report = parseVerificationReport({
      schemaVersion: 1,
      profiles: [...verificationProfiles].map(([repo, profile]) => ({ repo, fingerprint: profile.fingerprint })),
      round,
      checks,
      generatedAt: new Date().toISOString(),
      roundSummary: {
        durationMs: Date.now() - startedAt,
        agentDurationMs: reviewer.durationMs ?? 0,
        ...(reviewer.costUsd !== undefined ? { agentCostUsd: reviewer.costUsd } : {}),
        repairsCreated: changes.created,
        repairsReused: changes.reused,
        statusCounts,
        reviewerNote,
      },
    }, { profiles: verificationProfiles, round })
    const temporaryReport = `${reportPath}.${randomUUID()}.tmp`
    writeFileSync(temporaryReport, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
    renameSync(temporaryReport, reportPath)
    for (const check of report.checks)
      activity('Verificação', `${check.repo} · ${check.name}: ${check.status} — ${check.summary}`.slice(0, 240))
    verificationSummary = verificationChecksSummary(checks)
    const nonActionableCheckDetails = checks
      .filter((check) => ['skipped', 'inconclusive', 'ignored', 'failed', 'environment'].includes(check.status))
      .map((check) => `  ${check.status === 'skipped' ? 'Não executada' : check.status === 'inconclusive' ? 'Inconclusiva' : check.status === 'ignored' ? 'Irrelevante para o card' : check.status === 'environment' ? 'Problema de ambiente' : 'Falha relevante'} · ${check.repo} · ${check.name}: ${check.summary}`)
    if (nonActionableCheckDetails.length)
      verificationSummary += `\n${nonActionableCheckDetails.join('\n')}`
    if (!repairs.length) {
      verificationOk = verificationChecksSucceeded(checks)
      break
    }
    if (repairWaves >= maxRepairWaves) {
      verificationOk = false
      verificationSummary += ` · limite de ${maxRepairWaves} levas de correção atingido; novos reparos não foram agendados e o relatório foi preservado`
      break
    }
    if (changes.stalled) {
      verificationOk = false
      verificationSummary += ` · ${changes.stalled} reparo(s) sem progresso; execução interrompida`
      break
    }
    activity('Verificação', `${changes.created} task(s) de correção criadas; ${changes.reused} reutilizadas`)
    if (!changes.created && !changes.reused) {
      verificationOk = false
      verificationSummary += ' · nenhuma correção segura pôde ser agendada'
      break
    }
    repairWaves++
    await executeWave()
  }

  const finalItems = parseChecklist(readFileSync(file, 'utf8'))
  const allTasksDone = finalItems.length > 0 && finalItems.every((item) => item.state === 'done')
  const stageOk = allTasksDone && verificationOk
  const projectRuntimeSummary = [...verificationProfiles.values()]
    .map((profile) => `${profile.repo}: Node ${profile.runtime.project?.version ?? 'indisponível'} (${profile.runtime.project?.execPath ?? 'sem caminho'})${profile.runtime.warning ? ` · ${profile.runtime.warning}` : ''}`)
  const costReported = taskCostReported || verificationAgentCostReported
  const costSummary = costReported
    ? `Custo informado: $${(totalTaskCost + verificationAgentCost).toFixed(2)}`
    : 'Custo: indisponível no provider'

  finish(
    stageOk,
    [
      `Itens: ${finalItems.filter((item) => item.state === 'done').length}/${finalItems.length} concluídos, ${finalItems.filter((item) => item.state === 'failed').length} falhas, ${finalItems.filter((item) => item.state === 'blocked').length} bloqueados · ${costSummary} · Tempo de agente: ${formatDuration(totalTaskDuration)} · Tempo de verificações: ${formatDuration(verificationDuration)}`,
      ...projectRuntimeSummary,
      ...waveFailures.map((failure) => `${failure.id}: ${failure.note.split('\n')[0]}`),
      `Verificações: ${verificationSummary}`,
      ...(repairWaves ? [`Levas de correção executadas: ${repairWaves}`] : []),
      ...(unrecovered.size
        ? [
            '',
            'Trabalho preservado e NÃO integrado (nenhum código foi perdido):',
            ...[...unrecovered].map(([id, branch]) => `  ${id} → git log ${branch}`),
          ]
        : []),
    ].join('\n'),
  )
  process.exit(stageOk ? 0 : 1)
}

async function formatCardFiles(round: number): Promise<{ ok: boolean; summary: string }> {
  const outcomes: string[] = []
  for (const repo of [...new Set(parseChecklist(readFileSync(file, 'utf8')).map((item) => item.repo))]) {
    const profile = verificationProfiles.get(repo)
    if (!profile || profile.formatting.mode === 'disabled') {
      outcomes.push(`${repo}: skipped (${profile?.formatting.reason ?? 'perfil ausente'})`)
      continue
    }
    const formatter = profile.commands.some((command) => command.id === 'biome')
      ? 'biome'
      : profile.commands.some((command) => command.id === 'format-check')
        ? 'prettier'
        : undefined
    if (!formatter) {
      outcomes.push(`${repo}: skipped (formatter local não configurado)`)
      continue
    }
    const files = cardChangedFiles(repo)
    if (!files.length) {
      outcomes.push(`${repo}: passed (sem arquivos atuais no escopo)`)
      continue
    }
    const id = `FORMAT${round}_${repo.replace(/[^A-Za-z0-9_-]/g, '_')}`
    let cwd: string
    try {
      cwd = ensureItemWorktree(repoPath(repo), taskInfo(wsPath).id, repo, id)
    } catch (error) {
      return { ok: false, summary: `${repo}: não foi possível criar worktree exclusiva para formatação: ${error instanceof Error ? error.message : error}` }
    }
    const item: Item = {
      id,
      title: `Formatar arquivos do card na rodada ${round}`,
      repo,
      files,
      requires: [],
      creates: [],
      deps: [],
      context: 'Formatação determinística autorizada pelo perfil do projeto.',
      completionCriteria: [],
      state: 'pending',
      notes: [],
    }
    itemCwd.set(id, cwd)
    const result = await formatProjectFiles({
      cwd,
      files,
      formatter,
      node: profile.runtime.project!,
      allowWholeFile: profile.formatting.mode === 'whole-file',
      recordFile: join(wsPath, 'project-command-runs.jsonl'),
    })
    if (result.status === 'skipped') {
      outcomes.push(`${repo}: skipped (${result.stderr})`)
      dropItemWorktree(repoPath(repo), taskInfo(wsPath).id, repo, id)
      itemCwd.delete(id)
      continue
    }
    if (result.status !== 'passed') {
      outcomes.push(`${repo}: failed (${result.status})`)
      unrecovered.set(id, itemBranch(taskInfo(wsPath).id, id))
      return { ok: false, summary: `Formatação interrompida: ${outcomes.join('; ')}` }
    }
    const touched = changedFiles(cwd).filter((path) => !isInjected(path))
    const outsideScope = touched.filter((path) => !files.includes(path))
    if (outsideScope.length) {
      unrecovered.set(id, itemBranch(taskInfo(wsPath).id, id))
      return { ok: false, summary: `${repo}: formatador alterou arquivos fora do escopo: ${outsideScope.join(', ')}` }
    }
    if (touched.length) {
      const integrated = await commitItem(taskInfo(wsPath), item, id)
      if (integrated && integrated.status !== 'done') return { ok: false, summary: `${repo}: formatação não integrada: ${integrated.note}` }
    } else {
      dropItemWorktree(repoPath(repo), taskInfo(wsPath).id, repo, id)
      itemCwd.delete(id)
    }
    outcomes.push(`${repo}: passed (${touched.length} arquivo(s) formatado(s))`)
  }
  return { ok: true, summary: outcomes.join('; ') }
}

if (runsAsCommand(import.meta.url)) {
  void runDevStage().catch((error) => {
    finish(false, error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
