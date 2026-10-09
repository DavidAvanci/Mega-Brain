import { appendFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { runsAsCommand } from '../lib/env.ts'
import { markItem, matchesPattern, parseChecklist, pendingRequires, resetUnfinished, type Item } from '../lib/checklist.ts'
import { CmdError, changedFiles, defaultBranch, git, hasRef } from '../lib/git.ts'
import { activity, finish } from '../lib/log.ts'
import { itemContext, readPlan } from '../lib/plan.ts'
import { preflight } from '../lib/preflight.ts'
import { formatDuration, runChecklist, type ItemOutcome } from '../lib/scheduler.ts'
import { runClaudeItem } from '../lib/executor.ts'
import { megaBrainPrompt } from '../lib/prompts.ts'
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
const file = join(wsPath, 'TASK-CHECKLIST.md')

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

function limitsFor(item: Item): { timeoutMs: number; maxAttempts: number } {
  const timeoutMinutes = item.timeoutMinutes ?? positiveInt(process.env.CHECKLIST_TIMEOUT_MINUTES, 20, 'CHECKLIST_TIMEOUT_MINUTES')
  const maxAttempts = item.maxAttempts ?? positiveInt(process.env.CHECKLIST_MAX_ATTEMPTS, 3, 'CHECKLIST_MAX_ATTEMPTS')
  return { timeoutMs: timeoutMinutes * 60_000, maxAttempts }
}

function buildPrompt(item: Item, planRaw: string): string {
  const context = itemContext(planRaw, item.id)
  return [
    megaBrainPrompt('taskItem'),
    '',
    `Item: ${item.id} — ${item.text}`,
    item.files.length ? `Arquivos permitidos: ${item.files.join(', ')}` : 'Arquivos permitidos: (não especificado)',
    `Workspace da tarefa (vários repositórios): ${[...new Set(parseChecklist(readFileSync(file, 'utf8')).map(entry => entry.repo))].filter(repo => repo && existsSync(repoPath(repo))).map(repo => `${repo}: ${repoPath(repo)}`).join('; ')}`,
    `Implemente este item somente na worktree atual de ${item.repo}. Consulte os demais repositórios para entender contratos; mudanças neles devem ser feitas por seus próprios itens do checklist. Dependências entre itens coordenam a execução entre repositórios.`,
    context ? `\nContexto do plano:\n${context}` : '',
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

function commitMessage(task: ReturnType<typeof taskInfo>, item: Item): string[] {
  const subject = item.text.charAt(0).toLowerCase() + item.text.slice(1)
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
      return { status: 'failed', note: `Trabalho preservado em \`${branch}\`; conflito de integração: ${integration.conflict}.` }
    }
    discard()
    return integration.commits ? { status: 'done', note: `${integration.commits} commit(s) existentes foram integrados.` } : null
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

interface VerificationReport {
  checks: { repo: string; name: string; command: string; status: 'passed' | 'failed' | 'skipped'; summary: string }[]
  failures: { repo: string; check: string; command: string; summary: string; task: string; files?: string[] }[]
}

function verificationPrompt(projects: { repo: string; path: string; files: string[] }[], reportPath: string, round: number): string {
  return [
    `Item: VFY${round} — Verificar os projetos após a execução dos agentes`,
    'Você é o agente de verificação final. Em cada projeto, execute os checks relevantes (lint, formatação em modo check, typecheck, testes e hooks Husky) somente contra os arquivos listados para aquele projeto. Use argumentos de arquivo para limitar os checks. Se uma verificação não aceitar escopo por arquivo, registre-a como skipped; nunca rode um comando global do projeto.',
    'Descubra os comandos pelos manifests e configurações do projeto. Use scripts e binários que já estejam instalados localmente; não instale dependências nem use npx para baixar ferramentas. Não corrija arquivos, não faça commits e não altere TASK-CHECKLIST.md. Execute apenas comandos de verificação; não use modos que formatem ou modifiquem arquivos. Se um hook modificar arquivos ou não puder ser executado sem mudanças, registre-o como skipped com a razão. Projetos sem arquivos alterados também devem ser registrados com uma verificação skipped.',
    'Rode cada verificação relevante em cada projeto e registre resultado, comando e resumo. Para cada verificação que falhar, crie uma correção implementável, específica, em linguagem pt-BR, indicando os arquivos preferenciais quando identificáveis. Não crie correções para verificações skipped.',
    'Grave somente o relatório JSON no caminho indicado. Use exatamente este formato: {"checks":[{"repo":"alias","name":"lint","command":"comando executado","status":"passed|failed|skipped","summary":"resumo curto"}],"failures":[{"repo":"alias","check":"nome exato da verificação","command":"comando","summary":"erro observado","task":"ação de correção","files":["caminho/relativo"]}]}. Toda verificação failed deve ter pelo menos uma entrada correspondente em failures. Use arrays vazios quando não houver registros.',
    `Projetos, paths e lista exata de arquivos alterados pelo card: ${JSON.stringify(projects)}`,
    `Relatório JSON: ${reportPath}`,
  ].join('\n\n')
}

function cardChangedFiles(repo: string): string[] {
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
  const output = git(cwd, 'diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`)
  return output.split('\n').map((path) => path.trim()).filter(Boolean)
}

function readVerificationReport(path: string, repos: Set<string>): VerificationReport {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('Relatório de verificações inválido')
  const value = parsed as Record<string, unknown>
  if (!Array.isArray(value.checks) || !Array.isArray(value.failures)) throw new Error('Relatório de verificações sem checks/failures')
  const checks = value.checks.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Verificação inválida no relatório')
    const check = entry as Record<string, unknown>
    if (!repos.has(String(check.repo)) || typeof check.name !== 'string' || typeof check.command !== 'string' || typeof check.summary !== 'string' || !['passed', 'failed', 'skipped'].includes(String(check.status)))
      throw new Error('Campos ou repositório inválido em uma verificação')
    return { repo: String(check.repo), name: check.name, command: check.command, status: check.status as 'passed' | 'failed' | 'skipped', summary: check.summary }
  })
  const failures = value.failures.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('Correção inválida no relatório')
    const failure = entry as Record<string, unknown>
    if (!repos.has(String(failure.repo)) || typeof failure.check !== 'string' || typeof failure.command !== 'string' || typeof failure.summary !== 'string' || typeof failure.task !== 'string' || !failure.task.trim())
      throw new Error('Campos ou repositório inválido em uma correção')
    const files = Array.isArray(failure.files) ? failure.files.filter((path): path is string => typeof path === 'string' && Boolean(path.trim())) : []
    if (files.some((path) => path.startsWith('/') || path.includes('\\') || path.split('/').includes('..') || /[{},;]/.test(path)))
      throw new Error('A correção contém um caminho de arquivo inválido')
    return { repo: String(failure.repo), check: failure.check, command: failure.command, summary: failure.summary, task: failure.task.trim(), files }
  })
  for (const check of checks.filter((entry) => entry.status === 'failed')) {
    if (!failures.some((failure) => failure.repo === check.repo && failure.check === check.name))
      throw new Error('A falha ' + check.name + ' em ' + check.repo + ' não gerou task de correção')
  }
  for (const failure of failures) {
    if (!checks.some((check) => check.repo === failure.repo && check.name === failure.check && check.status === 'failed'))
      throw new Error('A correção não corresponde a uma verificação reprovada: ' + failure.check)
  }
  for (const repo of repos) {
    if (!checks.some((check) => check.repo === repo)) throw new Error('Nenhuma verificação foi reportada para ' + repo)
  }
  return { checks, failures }
}

function appendVerificationTasks(report: VerificationReport): number {
  const existing = new Set(parseChecklist(readFileSync(file, 'utf8')).map((item) => item.id))
  let next = 1
  const additions: string[] = []
  for (const failure of report.failures) {
    while (existing.has('VFY' + next)) next++
    const id = 'VFY' + next++
    existing.add(id)
    const clean = (value: string) => value.replace(/[\r\n{}]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
    const task = clean(failure.task)
    if (!task) throw new Error('A task de correção veio vazia')
    const description = task + ' (corrigir ' + clean(failure.check) + ': ' + clean(failure.summary) + ')'
    const meta = failure.files?.length ? ' {files: ' + failure.files.join(', ') + '}' : ''
    additions.push('## ' + failure.repo, '- [ ] ' + id + ' ' + description + meta)
  }
  if (additions.length) appendFileSync(file, (readFileSync(file, 'utf8').endsWith('\n') ? '' : '\n') + '\n' + additions.join('\n') + '\n')
  return report.failures.length
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
  if (!existsSync(file)) {
    finish(false, 'TASK-CHECKLIST.md não encontrado no workspace')
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
      ? pendingRequires(item, parsed, (pattern) => existsSync(join(repoPath(item.repo), pattern.replace(/\/?\*+$/, '')))).map((pattern) => `${item.id}: ${pattern}`)
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

  const runExecutorWave = () => runChecklist({
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
      })
      const result = await runClaudeItem({
        cwd,
        prompt: buildPrompt(item, plan.raw),
        model: AGENT.model,
        effort: AGENT.effort,
        tools: AGENT.tools,
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
  let totalTaskCost = 0
  let totalTaskDuration = 0
  const waveFailures: { id: string; note: string }[] = []
  const executeWave = async () => {
    const result = await runExecutorWave()
    totalTaskCost += result.costUsd
    totalTaskDuration += result.durationMs
    waveFailures.push(...result.failures)
    return result
  }
  await executeWave()

  const allowedRepos = new Set(repos)
  const maxRepairWaves = positiveInt(process.env.CHECKLIST_MAX_VERIFICATION_WAVES, 5, 'CHECKLIST_MAX_VERIFICATION_WAVES')
  let repairWaves = 0
  let verificationCost = 0
  let verificationDuration = 0
  let verificationOk = true
  let verificationSummary = ''
  for (let round = 1; ; round++) {
    const reportPath = join(wsPath, `verification-round-${round}.json`)
    try { unlinkSync(reportPath) } catch {}
    let projects: { repo: string; path: string; files: string[] }[]
    try {
      projects = repos.map((repo) => ({ repo, path: repoPath(repo), files: cardChangedFiles(repo) }))
    } catch (error) {
      verificationOk = false
      verificationSummary = `Não foi possível identificar os arquivos alterados pelo card: ${error instanceof Error ? error.message : error}`
      break
    }
    activity('Verificação', `Rodada ${round}: verificando ${projects.length} projeto(s) somente nos arquivos alterados pelo card`)
    const result = await runClaudeItem({
      cwd: wsPath,
      prompt: verificationPrompt(projects, reportPath, round),
      model: AGENT.model,
      effort: AGENT.effort,
      tools: AGENT.tools,
      timeoutMs: positiveInt(process.env.CHECKLIST_VERIFICATION_TIMEOUT_MINUTES, 60, 'CHECKLIST_VERIFICATION_TIMEOUT_MINUTES') * 60_000,
    })
    verificationCost += result.costUsd ?? 0
    verificationDuration += result.durationMs ?? 0
    if (result.status !== 'done' || !existsSync(reportPath)) {
      verificationOk = false
      verificationSummary = `O agente de verificação não concluiu: ${result.note || 'relatório ausente'}`
      break
    }

    let report: VerificationReport
    try {
      report = readVerificationReport(reportPath, allowedRepos)
    } catch (error) {
      verificationOk = false
      verificationSummary = `Relatório de verificações inválido: ${error instanceof Error ? error.message : error}`
      break
    }
    for (const check of report.checks) activity('Verificação', `${check.repo} · ${check.name}: ${check.status} — ${check.summary}`.slice(0, 240))
    verificationSummary = `${report.checks.filter((check) => check.status === 'passed').length} aprovadas, ${report.checks.filter((check) => check.status === 'failed').length} falhas, ${report.checks.filter((check) => check.status === 'skipped').length} ignoradas`
    if (!report.failures.length) break

    const added = appendVerificationTasks(report)
    activity('Verificação', `${added} task(s) de correção adicionadas à TASK-CHECKLIST.md`)
    if (repairWaves >= maxRepairWaves) {
      verificationOk = false
      verificationSummary += ` · limite de ${maxRepairWaves} levas de correção atingido; tasks pendentes foram preservadas`
      break
    }
    repairWaves++
    await executeWave()
  }

  const finalItems = parseChecklist(readFileSync(file, 'utf8'))
  const allTasksDone = finalItems.length > 0 && finalItems.every((item) => item.state === 'done')
  const stageOk = allTasksDone && verificationOk

  finish(
    stageOk,
    [
      `Itens: ${finalItems.filter((item) => item.state === 'done').length}/${finalItems.length} concluídos, ${finalItems.filter((item) => item.state === 'failed').length} falhas, ${finalItems.filter((item) => item.state === 'blocked').length} bloqueados · Custo: $${(totalTaskCost + verificationCost).toFixed(2)} · Tempo de agente: ${formatDuration(totalTaskDuration + verificationDuration)}`,
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

if (runsAsCommand(import.meta.url)) {
  void runDevStage().catch((error) => {
    finish(false, error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
