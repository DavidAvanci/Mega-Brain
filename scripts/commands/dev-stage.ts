import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { runsAsCommand } from '../lib/env.ts'
import { markItem, matchesPattern, parseChecklist, resetUnfinished, type Item } from '../lib/checklist.ts'
import { CmdError, changedFiles, git } from '../lib/git.ts'
import { activity, finish } from '../lib/log.ts'
import { itemContext, readPlan } from '../lib/plan.ts'
import { preflight } from '../lib/preflight.ts'
import { formatDuration, runChecklist, type ItemOutcome } from '../lib/scheduler.ts'
import { runClaudeItem } from '../lib/executor.ts'
import {
  assertFeatureBranch,
  dropItemWorktree,
  ensureItemWorktree,
  ensureWorktree,
  integrateItemBranch,
  isInjected,
  itemBranch,
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
const file = join(wsPath, 'TASK-CHECKLIST.md')
const testFile = join(wsPath, 'TEST-CHECKLIST.md')

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

function limitsFor(item: Item): { maxTurns: number; timeoutMs: number; maxAttempts: number } {
  const maxTurns = item.maxTurns ?? positiveInt(process.env.CHECKLIST_MAX_TURNS, 40, 'CHECKLIST_MAX_TURNS')
  const timeoutMinutes = item.timeoutMinutes ?? positiveInt(process.env.CHECKLIST_TIMEOUT_MINUTES, 20, 'CHECKLIST_TIMEOUT_MINUTES')
  const maxAttempts = item.maxAttempts ?? positiveInt(process.env.CHECKLIST_MAX_ATTEMPTS, 3, 'CHECKLIST_MAX_ATTEMPTS')
  return { maxTurns, timeoutMs: timeoutMinutes * 60_000, maxAttempts }
}

function buildPrompt(item: Item, planRaw: string): string {
  const context = itemContext(planRaw, item.id)
  return [
    '/exec-task-item',
    '',
    `Item: ${item.id} — ${item.text}`,
    item.files.length ? `Arquivos permitidos: ${item.files.join(', ')}` : 'Arquivos permitidos: (não especificado)',
    context ? `\nContexto do plano:\n${context}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function repairPrompt(item: Item, output: string): string {
  return [
    '/exec-task-item',
    '',
    `Item: ${item.id} — ${item.text}`,
    'Modo reparo: as alterações do item já estão no worktree, mas o hook de pre-commit reprovou.',
    'Corrija a causa exata do erro abaixo e nada além dela. Não reverta o item.',
    '',
    'Saída do hook:',
    '```',
    output.slice(-4000),
    '```',
  ].join('\n')
}

function failedTestRepairPrompt(item: Item): string {
  return [
    '/exec-task-item',
    '',
    `Correção orientada por teste que falhou: ${item.id} — ${item.text}`,
    ...item.details.map((detail) => `  ${detail}`),
    item.files.length ? `Arquivos preferenciais: ${item.files.join(', ')}` : '',
    '',
    'O cenário acima falhou na última execução de testes automáticos.',
    'Investigue a causa no código, aplique a correção necessária e execute a validação mais específica possível.',
    'Não altere TEST-CHECKLIST.md nem marque o cenário como aprovado: ele será executado novamente na próxima etapa de testes.',
  ]
    .filter(Boolean)
    .join('\n')
}

const itemCwd = new Map<string, string>()
const unrecovered = new Map<string, string>()
const repoLocks = new Map<string, Promise<unknown>>()

function withRepoLock<T>(repo: string, fn: () => T): Promise<T> {
  const previous = repoLocks.get(repo) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  repoLocks.set(
    repo,
    next.catch(() => undefined),
  )
  return next
}

const HOOK_FAILURE = /husky|pre-commit|lint-staged/i

function commitMessage(task: ReturnType<typeof taskInfo>, item: Item): string[] {
  const subject = item.text.charAt(0).toLowerCase() + item.text.slice(1)
  const args = ['commit', '-m', `${task.type === 'fix' ? 'fix' : 'feat'}: ${subject}`.slice(0, 100)]
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
      return { status: 'failed', note: `Trabalho preservado em \`${branch}\`; conflito de integração: ${integration.conflict}.` }
    }
    discard()
    return integration.commits ? { status: 'done', note: `${integration.commits} commit(s) existentes foram integrados.` } : null
  }

  let repair: ItemOutcome | undefined
  stageItemChanges(cwd)
  try {
    git(cwd, ...commitMessage(task, item))
  } catch (error) {
    const output = error instanceof CmdError ? error.raw : String(error)
    if (!HOOK_FAILURE.test(output)) {
      return { status: 'failed', note: `Commit falhou: ${output.split('\n').slice(-3).join(' | ')}` }
    }
    activity('Item', `${item.id} pre-commit reprovou — tentando reparo automático`)
    repair = await runClaudeItem({
      cwd,
      prompt: repairPrompt(item, output),
      model: AGENT.model,
      effort: AGENT.effort,
      tools: AGENT.tools,
      maxTurns: limitsFor(item).maxTurns,
      timeoutMs: limitsFor(item).timeoutMs,
    })
    try {
      stageItemChanges(cwd)
      git(cwd, ...commitMessage(task, item))
    } catch (retry) {
      const detail = retry instanceof CmdError ? retry.raw : String(retry)
      return {
        status: 'failed',
        note: `Pre-commit reprovou mesmo após o reparo automático: ${detail.split('\n').slice(-3).join(' | ')}`,
        costUsd: repair.costUsd,
        durationMs: repair.durationMs,
      }
    }
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
      costUsd: repair?.costUsd,
      durationMs: repair?.durationMs,
    }
  }

  discard()
  const widen = item.files.length
    ? touched.filter((path) => !item.files.some((pattern) => matchesPattern(path, pattern)))
    : []
  const notes = [
    repair ? 'Pre-commit reprovou e foi corrigido por um agente de reparo.' : '',
    widen.length ? `Arquivos fora do \`files\` declarado (acrescentados ao checklist): ${widen.join(', ')}` : '',
  ].filter(Boolean)
  return {
    status: 'done',
    note: notes.join(' '),
    costUsd: repair?.costUsd,
    durationMs: repair?.durationMs,
    widen,
  }
}

async function repairFailedTests(task: ReturnType<typeof taskInfo>): Promise<ItemOutcome[]> {
  if (!existsSync(testFile)) return []
  const failed = parseChecklist(readFileSync(testFile, 'utf8')).filter((item) => item.state === 'failed')
  const outcomes: ItemOutcome[] = []

  for (const item of failed) {
    activity('Reparo de teste', `${item.id} ${item.text}`.slice(0, 120))
    if (!item.repo || !existsSync(repoPath(item.repo))) {
      outcomes.push({
        status: 'blocked',
        note: `${item.id}: Repo desconhecido: ${item.repo || '(sem heading ## repo)'}`,
      })
      continue
    }
    try {
      ensureWorktree(wsPath, item.repo, task.id, task.branch)
    } catch (error) {
      outcomes.push({
        status: 'blocked',
        note: `${item.id}: Worktree indisponível: ${error instanceof Error ? error.message : error}`,
      })
      continue
    }
    if (changedFiles(repoPath(item.repo)).length) {
      outcomes.push({ status: 'blocked', note: `${item.id}: Worktree de integração suja em ${item.repo}.` })
      continue
    }

    const worktreeId = `test-${item.id}`
    let cwd: string
    try {
      cwd = ensureItemWorktree(repoPath(item.repo), task.id, item.repo, worktreeId)
    } catch (error) {
      outcomes.push({
        status: 'failed',
        note: `${item.id}: Falha ao criar a worktree: ${error instanceof Error ? error.message : error}`,
      })
      continue
    }
    itemCwd.set(item.id, cwd)
    let outcome: ItemOutcome = await runClaudeItem({
      cwd,
      prompt: failedTestRepairPrompt(item),
      model: AGENT.model,
      effort: AGENT.effort,
      tools: AGENT.tools,
      maxTurns: 40,
      timeoutMs: 20 * 60_000,
    })
    if (outcome.status === 'done') {
      outcome = (await commitItem(task, item, worktreeId)) ?? {
        status: 'failed',
        note: `${item.id}: O reparo não gerou alterações para commitar.`,
      }
    }
    outcomes.push(outcome)
  }
  return outcomes
}

function patternExists(repo: string, pattern: string): boolean {
  let base: string
  try {
    base = realRepoPath(repo)
  } catch {
    return false
  }
  const clean = pattern.replace(/\/?\*+$/, '')
  const path = join(base, clean)
  return existsSync(path) || existsSync(dirname(path))
}

function reportPreflight(items: Item[]): boolean {
  const issues = preflight(items, {
    repoExists: (repo) => {
      try {
        realRepoPath(repo)
        return true
      } catch {
        return false
      }
    },
    pathExists: patternExists,
  })
  for (const issue of issues) {
    activity('Preflight', `${issue.level === 'error' ? 'Erro' : 'Aviso'} — ${issue.where}: ${issue.message}`)
  }
  const errors = issues.filter((issue) => issue.level === 'error')
  if (!errors.length) return true
  finish(
    false,
    [
      `Preflight reprovou o TASK-CHECKLIST.md (${errors.length} erro(s)) — nenhum agente foi gasto:`,
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
  if (!existsSync(file)) {
    finish(false, 'TASK-CHECKLIST.md não encontrado no workspace')
    return
  }
  const task = taskInfo(wsPath)
  const plan = readPlan(wsPath)
  const parsed = parseChecklist(readFileSync(file, 'utf8'))
  if (!process.env.CHECKLIST_SKIP_PREFLIGHT && !reportPreflight(parsed)) {
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
      const environment = projectEnvironmentIssue(worktree)
      if (environment) throw new Error(environment)
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
      ? item.requires.filter((pattern) => !existsSync(join(repoPath(item.repo), pattern.replace(/\/?\*+$/, '')))).map((pattern) => `${item.id}: ${pattern}`)
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

  const summary = await runChecklist({
    file,
    max: 4,
    execute: async (item) => {
      const skipReason = skippedRepos.get(item.repo)
      if (skipReason) return { status: 'blocked' as const, note: `Heading "${item.repo}" pulada: ${skipReason}` }
      if (!item.repo || !existsSync(repoPath(item.repo))) {
        return { status: 'blocked' as const, note: `Repo desconhecido: ${item.repo || '(sem heading ## repo)'}` }
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
      const limits = limitsFor(item)
      let previousAttempts = 0
      try {
        const saved: unknown = JSON.parse(readFileSync(join(wsPath, 'execution-attempts.json'), 'utf8'))
        if (Array.isArray(saved)) previousAttempts = saved.filter((entry) => (entry as { itemId?: unknown }).itemId === item.id).length
      } catch {}
      if (previousAttempts >= limits.maxAttempts) {
        return {
          status: 'blocked' as const,
          note: `Teto de ${limits.maxAttempts} tentativas atingido; trabalho salvo em \`${itemBranch(task.id, item.id)}\`. Corrija a causa ou divida o item antes de retomar.`,
        }
      }
      const attemptId = `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const startedAt = new Date().toISOString()
      recordAttempt(wsPath, {
        id: attemptId,
        itemId: item.id,
        repo: item.repo,
        status: 'running',
        startedAt,
        model: AGENT.model,
        maxTurns: limits.maxTurns,
        timeoutMs: limits.timeoutMs,
        branch: itemBranch(task.id, item.id),
        worktree: cwd,
        commitBefore: git(cwd, 'rev-parse', 'HEAD'),
        environment: process.version,
      })
      const result = await runClaudeItem({
        cwd,
        prompt: buildPrompt(item, plan.raw),
        model: AGENT.model,
        effort: AGENT.effort,
        tools: AGENT.tools,
        maxTurns: limits.maxTurns,
        timeoutMs: limits.timeoutMs,
      })
      recordAttempt(wsPath, {
        id: attemptId,
        itemId: item.id,
        repo: item.repo,
        status: result.status,
        startedAt,
        finishedAt: new Date().toISOString(),
        model: AGENT.model,
        maxTurns: limits.maxTurns,
        timeoutMs: limits.timeoutMs,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        note: result.note,
        branch: itemBranch(task.id, item.id),
        worktree: cwd,
        commitAfter: git(cwd, 'rev-parse', 'HEAD'),
        environment: process.version,
      })
      return result
    },
    afterDone: (item) => commitItem(task, item),
  })

  const testRepairs = await repairFailedTests(task)
  const failedRepairs = testRepairs.filter((outcome) => outcome.status !== 'done')
  const repairCost = testRepairs.reduce((total, outcome) => total + (outcome.costUsd ?? 0), 0)
  const repairDuration = testRepairs.reduce((total, outcome) => total + (outcome.durationMs ?? 0), 0)

  finish(
    summary.ok && !failedRepairs.length,
    [
      `Itens: ${summary.done}/${summary.total} concluídos, ${summary.failed} falhas, ${summary.blocked} bloqueados · Custo: $${(summary.costUsd + repairCost).toFixed(2)} · Tempo de agente: ${formatDuration(summary.durationMs + repairDuration)}`,
      ...summary.failures.map((failure) => `${failure.id}: ${failure.note.split('\n')[0]}`),
      ...(testRepairs.length
        ? [
            `Reparos de testes falhos: ${testRepairs.length - failedRepairs.length}/${testRepairs.length} aplicados.`,
            ...failedRepairs.map((outcome) => outcome.note.split('\n')[0]),
          ]
        : []),
      ...(unrecovered.size
        ? [
            '',
            'Trabalho preservado e NÃO integrado (nenhum código foi perdido):',
            ...[...unrecovered].map(([id, branch]) => `  ${id} → git log ${branch}`),
          ]
        : []),
    ].join('\n'),
  )
  process.exit(summary.ok ? 0 : 1)
}

if (runsAsCommand(import.meta.url)) {
  void runDevStage().catch((error) => {
    finish(false, error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
