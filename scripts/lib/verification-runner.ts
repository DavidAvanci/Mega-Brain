import { resolve } from 'node:path'
import type { VerificationCheck, VerificationProfile } from '../../shared/domain/verification.ts'
import { compareDiagnosticBaseline, runIsolatedVerificationBaseline } from './verification-baseline.ts'
import { runProjectCommand } from './project-command.ts'
import { classifyCheckOutcome, parseAdapterDiagnostics } from './verification-report.ts'
import { verificationFilesForCommand } from './verification-profile.ts'

export interface VerificationProjectInput {
  repo: string
  path: string
  baseRef: string
  files: string[]
  renamed: { from: string; to: string }[]
}

export async function runVerificationChecks(options: {
  projects: VerificationProjectInput[]
  profiles: Map<string, VerificationProfile>
  round: number
  baselineRoot: string
  recordFile?: string
}): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = []
  const baselines = new Map<string, Awaited<ReturnType<typeof runIsolatedVerificationBaseline>>>()
  await Promise.all(options.projects.map(async (project) => {
    const profile = options.profiles.get(project.repo)
    const hasRunnableFiles = profile?.commands.some((command) => command.scope === 'card-files' && verificationFilesForCommand(command, project.files).files.length)
    if (profile?.commands.length && hasRunnableFiles) {
      baselines.set(project.repo, await runIsolatedVerificationBaseline({
        repoPath: project.path,
        baseRef: project.baseRef,
        worktreePath: resolve(options.baselineRoot, project.repo),
        repo: project.repo,
        files: [...new Set([...project.files, ...project.renamed.map((entry) => entry.from)])],
        runtimeOptions: { override: profile.runtime.requirement.source === 'override' ? profile.runtime.requirement.value : undefined, policy: profile.runtime.requirement.policy },
      }))
    }
  }))
  for (const project of options.projects) {
    const profile = options.profiles.get(project.repo)
    if (!profile) {
      checks.push({ id: `profile-${project.repo}`, repo: project.repo, name: 'profile', status: 'environment', cause: 'environment', summary: 'Perfil de verificações indisponível.', profileFingerprint: 'missing' })
      continue
    }
    if (!project.files.length) {
      checks.push({ id: 'scope', repo: project.repo, name: 'scope', status: 'skipped', summary: 'O card não tem arquivos atuais para verificar.', profileFingerprint: profile.fingerprint })
      continue
    }
    const baseline = baselines.get(project.repo) ?? { status: 'inconclusive' as const, reason: 'Perfil sem checks por arquivo; baseline não aplicável.' }
    const comparable = baseline.status === 'ready' && baseline.profileFingerprint === profile.fingerprint
    for (const command of profile.commands) {
      const { files, excluded } = command.scope === 'project'
        ? { files: [] as string[], excluded: [] as string[] }
        : verificationFilesForCommand(command, project.files)
      if (command.scope !== 'project' && !files.length) {
        checks.push({ id: command.id, repo: project.repo, name: command.id, status: 'skipped', summary: excluded.length ? `Nenhum arquivo elegível; excluídos: ${excluded.join(', ')}.` : 'Nenhum arquivo no escopo do comando.', profileFingerprint: profile.fingerprint })
        continue
      }
      const runnerResult = await runProjectCommand(
        {
          id: command.id,
          argv: [...command.argv, ...files],
          cwd: project.path,
          timeoutMs: command.timeoutMs,
          recordFile: options.recordFile,
        },
        profile.runtime.project!,
      ).catch((error) => ({ status: 'unavailable' as const, summary: error instanceof Error ? error.message : String(error) }))
      if (command.scope === 'project') {
        const failure = classifyCheckOutcome({ repo: project.repo, profile, commandId: command.id, files: [], result: runnerResult })
        if (runnerResult.status === 'passed') {
          checks.push({ ...failure, status: 'passed', cause: undefined, summary: 'Script do projeto terminou com código zero.', durationMs: 'durationMs' in runnerResult ? runnerResult.durationMs : 0 })
        } else {
          const exitCode = 'code' in runnerResult ? runnerResult.code : undefined
          const output = 'stdout' in runnerResult ? `${runnerResult.stdout}\n${runnerResult.stderr}`.trim() : runnerResult.summary
          checks.push({
            ...failure,
            status: failure.status === 'environment' ? 'environment' : 'failed',
            cause: failure.status === 'environment' ? failure.cause : 'unknown',
            summary: failure.status === 'environment' ? failure.summary : `Script do projeto terminou com código ${exitCode ?? 'desconhecido'}; requer análise de relevância.`,
            ...(failure.status === 'environment' ? {} : { relevance: { result: 'pending' as const, reason: 'Aguardando análise da relação com as mudanças do card.' } }),
            output: output.slice(-16_000),
            files: project.files,
            ...('durationMs' in runnerResult ? { durationMs: runnerResult.durationMs } : {}),
          })
        }
        continue
      }
      const current = runnerResult.status === 'unavailable' || runnerResult.status === 'cancelled' || runnerResult.status === 'timeout'
        ? undefined
        : parseAdapterDiagnostics(command.id, runnerResult.stdout, project.path, project.repo, files)
      const baselineResult = comparable
        ? compareDiagnosticBaseline(baseline.diagnostics?.[command.id] ?? null, current ?? [], { configurationMatches: true, renamedFiles: project.renamed })
        : { status: 'inconclusive' as const, reason: baseline.status === 'ready' ? 'Fingerprint do perfil da base diverge do card.' : baseline.reason ?? 'Baseline indisponível.' }
      const check = classifyCheckOutcome({
        repo: project.repo,
        profile,
        commandId: command.id,
        files,
        result: runnerResult,
        baseline: current === null ? { status: 'inconclusive', reason: 'A saída do check não foi analisável.' } : baselineResult,
        currentDiagnostics: current === undefined || baselineResult.status !== 'comparable' ? undefined : baselineResult.newDiagnostics,
      })
      if (check.status === 'failed' && check.diagnostics === undefined) {
        const newDiagnostics = baselineResult.status === 'comparable' ? baselineResult.newDiagnostics : []
        check.diagnostics = newDiagnostics
        check.files = [...new Set(newDiagnostics.map((item) => item.file))]
      }
      if ('durationMs' in runnerResult && typeof runnerResult.durationMs === 'number')
        check.durationMs = runnerResult.durationMs
      if (excluded.length) check.summary += ` Arquivos ignorados: ${excluded.join(', ')}.`
      checks.push(check)
    }
    for (const skipped of profile.skipped) {
      checks.push({ id: `skipped-${skipped.id}`, repo: project.repo, name: skipped.id, status: 'skipped', summary: skipped.reason, profileFingerprint: profile.fingerprint })
    }
    if (baseline.status === 'inconclusive' || !comparable) {
      for (const check of checks.filter((entry) => entry.repo === project.repo && entry.status === 'passed')) {
        check.status = 'inconclusive'
        check.cause = 'unknown'
        check.summary = `Execução passou, mas baseline não comparável: ${baseline.reason ?? 'fingerprint diferente.'}`
      }
    }
  }
  return checks
}
