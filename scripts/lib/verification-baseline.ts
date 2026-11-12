import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { installCommand, lockfilesMatch } from './packageManager.ts'
import { parseAdapterDiagnostics } from './verification-report.ts'
import { runProjectCommand } from './project-command.ts'
import { resolveProjectNode } from './project-node.ts'
import { discoverVerificationProfile, verificationFilesForCommand } from './verification-profile.ts'

export interface Diagnostic {
  repo: string
  file: string
  rule: string
  message: string
}

export interface BaselineRunResult {
  status: 'ready' | 'inconclusive'
  reason?: string
  profileFingerprint?: string
  diagnostics?: Record<string, Diagnostic[]>
}
export type BaselineResult =
  | { status: 'comparable'; newDiagnostics: Diagnostic[]; existingCount: number }
  | { status: 'inconclusive'; reason: string }

export async function prepareBaselineDependencies(options: {
  projectPath: string
  baselinePath: string
  runtime: { execPath: string; version?: string }
}): Promise<{ status: 'ready' } | { status: 'inconclusive'; reason: string }> {
  const projectModules = join(options.projectPath, 'node_modules')
  if (lockfilesMatch(options.projectPath, options.baselinePath) && existsSync(projectModules)) {
    symlinkSync(realpathSync(projectModules), join(options.baselinePath, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    return { status: 'ready' }
  }
  const install = installCommand(options.baselinePath)
  const installed = await runProjectCommand(
    {
      id: 'baseline-install',
      argv: [install.cmd, ...install.args],
      cwd: options.baselinePath,
      timeoutMs: 30 * 60_000,
      environment: { PATH: [dirname(options.runtime.execPath), process.env.PATH].filter(Boolean).join(delimiter) },
    },
    options.runtime,
  )
  return installed.status === 'passed'
    ? { status: 'ready' }
    : { status: 'inconclusive', reason: `Install isolado da base falhou (${installed.status}).` }
}

export function removeBaselineModulesLink(worktreePath: string): void {
  const modules = join(worktreePath, 'node_modules')
  if (lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(modules)
}

/** Compares diagnostics as a multiset, preserving duplicate occurrences without using line numbers. */
export function compareDiagnosticBaseline(
  base: Diagnostic[] | null,
  current: Diagnostic[],
  options: { configurationMatches?: boolean; renamedFiles?: { from: string; to: string }[] } = {},
): BaselineResult {
  if (!base) return { status: 'inconclusive', reason: 'A análise da base não produziu diagnósticos confiáveis.' }
  if (options.configurationMatches === false)
    return { status: 'inconclusive', reason: 'Configuração, dependências ou runtime diferem entre base e card.' }
  const reverseRenames = new Map((options.renamedFiles ?? []).map((entry) => [entry.to, entry.from]))
  const key = (item: Diagnostic) =>
    JSON.stringify([item.repo, reverseRenames.get(item.file) ?? item.file, item.rule, item.message])
  const counts = new Map<string, number>()
  for (const item of base) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  const newDiagnostics: Diagnostic[] = []
  for (const item of current) {
    const fingerprint = key(item)
    const count = counts.get(fingerprint) ?? 0
    if (count) counts.set(fingerprint, count - 1)
    else newDiagnostics.push(item)
  }
  return {
    status: 'comparable',
    newDiagnostics,
    existingCount: base.length - [...counts.values()].reduce((sum, value) => sum + value, 0),
  }
}

/** Runs the base revision in an isolated temporary Git worktree, including its own locked install. */
export async function runIsolatedVerificationBaseline(options: {
  repoPath: string
  baseRef: string
  worktreePath: string
  repo: string
  files: string[]
  runtimeOptions?: { override?: string; policy?: import('../../shared/domain/project-runtime.ts').RuntimePolicy }
}): Promise<BaselineRunResult> {
  let worktreeAdded = false
  try {
    mkdirSync(dirname(options.worktreePath), { recursive: true })
    execFileSync('git', ['worktree', 'add', '--quiet', '--detach', options.worktreePath, options.baseRef], { cwd: options.repoPath, stdio: 'ignore' })
    worktreeAdded = true
    const resolution = resolveProjectNode(options.worktreePath, { ...options.runtimeOptions, allowServerDefault: true })
    if (resolution.status !== 'resolved' || !resolution.runtime?.project)
      return { status: 'inconclusive', reason: resolution.diagnostic ?? 'Node da baseline indisponível.' }
    if (!existsSync(join(options.worktreePath, 'package.json')))
      return { status: 'inconclusive', reason: 'A base não contém package.json para validar o contexto do projeto.' }
    const dependencies = await prepareBaselineDependencies({ projectPath: options.repoPath, baselinePath: options.worktreePath, runtime: resolution.runtime.project })
    if (dependencies.status === 'inconclusive') return dependencies
    const profile = discoverVerificationProfile(options.worktreePath, options.repo, options.runtimeOptions)
    const diagnostics: Record<string, Diagnostic[]> = {}
    for (const command of profile.commands) {
      if (command.scope !== 'card-files') continue
      const scoped = verificationFilesForCommand(command, options.files).files.filter((file) => existsSync(join(options.worktreePath, file)))
      if (!scoped.length) {
        diagnostics[command.id] = []
        continue
      }
      const result = await runProjectCommand(
        { id: command.id, argv: [...command.argv, ...scoped], cwd: options.worktreePath, timeoutMs: command.timeoutMs },
        profile.runtime.project!,
      )
      const parsed = parseAdapterDiagnostics(command.id, result.stdout, options.worktreePath, options.repo, scoped)
      if (parsed === null)
        return { status: 'inconclusive', reason: `A saída ${command.id} da base não pôde ser analisada estruturalmente.` }
      diagnostics[command.id] = parsed
    }
    return { status: 'ready', profileFingerprint: profile.fingerprint, diagnostics }
  } catch (error) {
    return { status: 'inconclusive', reason: error instanceof Error ? error.message : String(error) }
  } finally {
    try { removeBaselineModulesLink(options.worktreePath) } catch { /* Preserve the original diagnostic result. */ }
    if (worktreeAdded) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', options.worktreePath], { cwd: options.repoPath, stdio: 'ignore' })
      } catch {
        /* The original diagnostic result is more useful than a cleanup failure. */
      }
    }
  }
}
