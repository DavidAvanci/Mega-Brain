import type {
  CheckStatus,
  VerificationCheck,
  VerificationProfile,
  VerificationReport,
} from '../../shared/domain/verification.ts'
import type { ProjectCommandResult } from './project-command.ts'
import type { Diagnostic, BaselineResult } from './verification-baseline.ts'
import { relative, resolve, sep } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

function canonicalPath(path: string): string {
  const absolute = resolve(path)
  return existsSync(absolute) ? realpathSync(absolute) : absolute
}

export function verificationChecksSucceeded(checks: VerificationCheck[]): boolean {
  return checks.length > 0 && !checks.some((check) => ['failed', 'environment', 'inconclusive'].includes(check.status))
}

export function verificationChecksSummary(checks: VerificationCheck[]): string {
  const counts = Object.fromEntries(['passed', 'failed', 'skipped', 'environment', 'inconclusive', 'ignored'].map((status) => [status, checks.filter((check) => check.status === status).length]))
  const details = `${counts.passed} aprovadas, ${counts.failed} falhas, ${counts.skipped} ignoradas, ${counts.environment} ambientais, ${counts.inconclusive} inconclusivas, ${counts.ignored} irrelevantes ao card`
  return counts.passed + counts.failed + counts.environment + counts.inconclusive === 0 && counts.skipped + counts.ignored > 0
    ? `${details} · nada foi validado`
    : details
}

export function parseEslintDiagnostics(stdout: string, cwd: string, repo: string): Diagnostic[] | null {
  let output: unknown
  try {
    output = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!Array.isArray(output)) return null
  const diagnostics: Diagnostic[] = []
  for (const file of output) {
    if (!file || typeof file !== 'object' || typeof file.filePath !== 'string' || !Array.isArray(file.messages)) return null
    const path = relative(canonicalPath(cwd), canonicalPath(file.filePath)).split(sep).join('/')
    if (path === '..' || path.startsWith('../') || path.startsWith('/')) return null
    for (const message of file.messages) {
      if (!message || typeof message !== 'object' || typeof message.message !== 'string') return null
      diagnostics.push({ repo, file: path, rule: typeof message.ruleId === 'string' ? message.ruleId : '<parser>', message: message.message })
    }
  }
  return diagnostics
}

export function parseAdapterDiagnostics(
  commandId: string,
  stdout: string,
  cwd: string,
  repo: string,
  expectedFiles: string[],
): Diagnostic[] | null {
  if (commandId === 'eslint') return parseEslintDiagnostics(stdout, cwd, repo)
  if (commandId === 'format-check') {
    const found = stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^\[warn\]\s+(.+?)\s*$/)?.[1]?.replaceAll('\\', '/'))
      .filter((path): path is string => Boolean(path))
    if (found.some((path) => !expectedFiles.includes(path))) return null
    return [...new Set(found)].map((file) => ({ repo, file, rule: 'format', message: 'Arquivo não está formatado.' }))
  }
  if (commandId === 'biome') {
    let parsed: unknown
    try { parsed = JSON.parse(stdout) } catch { return null }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>).diagnostics)) return null
    const diagnostics: Diagnostic[] = []
    for (const entry of (parsed as { diagnostics: unknown[] }).diagnostics) {
      if (!entry || typeof entry !== 'object') return null
      const value = entry as Record<string, unknown>
      const location = value.location && typeof value.location === 'object' ? (value.location as Record<string, unknown>) : {}
      const pathInfo = location.path && typeof location.path === 'object' ? (location.path as Record<string, unknown>) : {}
      const rawPath = typeof pathInfo.file === 'string' ? pathInfo.file : undefined
      const message = typeof value.message === 'string' ? value.message : undefined
      if (!rawPath || !message) return null
      const file = relative(canonicalPath(cwd), canonicalPath(rawPath)).split(sep).join('/')
      if (file.startsWith('../') || file === '..' || !expectedFiles.includes(file)) return null
      diagnostics.push({ repo, file, rule: typeof value.category === 'string' ? value.category : '<biome>', message })
    }
    return diagnostics
  }
  return null
}

export function classifyCheckOutcome(input: {
  repo: string
  profile: VerificationProfile
  commandId: string
  files: string[]
  result: ProjectCommandResult | { status: 'unavailable'; summary: string }
  baseline?: BaselineResult
  currentDiagnostics?: Diagnostic[]
}): VerificationCheck {
  const command = input.profile.commands.find((entry) => entry.id === input.commandId)
  if (!command) throw new Error(`Check ${input.commandId} não pertence ao perfil de ${input.repo}`)
  let status: CheckStatus
  let cause: VerificationCheck['cause']
  let summary: string
  if (input.result.status === 'unavailable') {
    status = 'environment'
    cause = 'environment'
    summary = input.result.summary
  } else if (input.result.status === 'passed') {
    status = 'passed'
    summary = 'Comando terminou com código zero.'
  } else if (input.result.status === 'cancelled') {
    status = 'inconclusive'
    summary = 'Comando cancelado antes de produzir resultado.'
  } else {
    const output = `${input.result.stderr}\n${input.result.stdout}`
    if (/out of memory|heap limit|JavaScript heap|ENOMEM|killed process/i.test(output)) {
      status = 'environment'
      cause = 'resource'
      summary = `Falha de recurso detectada pelo processo (${input.result.status}).`
    } else if (/command not found|not recognized as an internal|ENOENT|cannot find module|module not found/i.test(output)) {
      status = 'environment'
      cause = 'environment'
      summary = 'Comando ou dependência exigida pelo check não está disponível.'
    } else if (input.result.status === 'timeout') {
      status = 'environment'
      cause = 'resource'
      summary = 'O check excedeu o timeout configurado.'
    } else if (input.baseline?.status === 'comparable' && input.currentDiagnostics !== undefined) {
      status = input.currentDiagnostics.length > 0 ? 'failed' : 'passed'
      if (status === 'failed') cause = 'code'
      summary = input.currentDiagnostics.length
        ? `Foram encontrados ${input.currentDiagnostics.length} diagnósticos novos atribuíveis ao escopo.`
        : 'Os diagnósticos atuais não excedem os observados na baseline.'
    } else {
      status = 'inconclusive'
      cause = 'unknown'
      summary =
        input.baseline?.status === 'inconclusive'
          ? input.baseline.reason
          : 'Falha sem diagnóstico estrutural comparável à baseline.'
    }
  }
  return {
    id: input.commandId,
    repo: input.repo,
    name: command.id,
    status,
    ...(cause ? { cause } : {}),
    summary,
    commandId: command.id,
    profileFingerprint: input.profile.fingerprint,
    files: input.files,
  }
}

export function parseVerificationReport(
  input: unknown,
  expected: { profiles: Map<string, VerificationProfile>; round: number },
): VerificationReport {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Relatório inválido: esperado objeto')
  const value = input as Record<string, unknown>
  if (value.schemaVersion !== 1 || value.round !== expected.round || !Array.isArray(value.checks))
    throw new Error('Relatório não corresponde à versão, perfil ou rodada autorizados')
  if (!Array.isArray(value.profiles)) throw new Error('Relatório sem perfis autorizados')
  const reportedProfiles = new Set<string>()
  for (const profile of value.profiles) {
    if (!profile || typeof profile !== 'object') throw new Error('Identidade de perfil inválida')
    const entry = profile as Record<string, unknown>
    const authorized = expected.profiles.get(String(entry.repo))
    if (!authorized || entry.fingerprint !== authorized.fingerprint)
      throw new Error('Relatório usa perfil não autorizado')
    if (reportedProfiles.has(String(entry.repo))) throw new Error('Relatório repete um perfil')
    reportedProfiles.add(String(entry.repo))
  }
  if (reportedProfiles.size !== expected.profiles.size) throw new Error('Relatório omite um perfil de repositório')
  const checks: VerificationCheck[] = value.checks.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Check inválido')
    const check = item as Record<string, unknown>
    const statuses: CheckStatus[] = ['passed', 'failed', 'skipped', 'environment', 'inconclusive', 'ignored']
    if (
      typeof check.repo !== 'string' ||
      !expected.profiles.has(check.repo) ||
      typeof check.id !== 'string' ||
      typeof check.name !== 'string' ||
      typeof check.summary !== 'string' ||
      typeof check.profileFingerprint !== 'string' ||
      !statuses.includes(check.status as CheckStatus)
    )
      throw new Error('Campos ou repo inválido no check')
    if (
      check.files !== undefined &&
      (!Array.isArray(check.files) ||
        check.files.some(
          (file) => typeof file !== 'string' || file.startsWith('/') || file.includes('\\') || file.split('/').includes('..'),
        ))
    )
      throw new Error('Escopo de arquivo inválido')
    const profile = expected.profiles.get(check.repo)
    if (profile?.fingerprint !== check.profileFingerprint) throw new Error('Check usa perfil não autorizado')
    if (
      check.status === 'failed' &&
      !['code', 'environment', 'resource', 'configuration', 'unknown'].includes(String(check.cause))
    )
      throw new Error('Falha sem causa classificada')
    if (
      check.cause !== undefined &&
      !['code', 'environment', 'resource', 'configuration', 'unknown'].includes(String(check.cause))
    )
      throw new Error('Causa do check inválida')
    if (check.durationMs !== undefined && (typeof check.durationMs !== 'number' || check.durationMs < 0))
      throw new Error('Duração do check inválida')
    if (
      check.status !== 'skipped' &&
      (!check.commandId || !profile?.commands.some((command) => command.id === check.commandId))
    )
      throw new Error('Comando não pertence ao perfil autorizado')
    if (
      check.status === 'failed' &&
      check.cause === 'code' &&
      (!Array.isArray(check.files) || check.files.length === 0)
    )
      throw new Error('Falha de código sem arquivos atribuídos ao card')
    if (check.diagnostics !== undefined) {
      if (!Array.isArray(check.diagnostics)) throw new Error('Diagnósticos inválidos')
      for (const item of check.diagnostics) {
        if (!item || typeof item !== 'object') throw new Error('Diagnóstico inválido')
        const diagnostic = item as Record<string, unknown>
        if (
          typeof diagnostic.file !== 'string' ||
          typeof diagnostic.rule !== 'string' ||
          typeof diagnostic.message !== 'string' ||
          !Array.isArray(check.files) ||
          !check.files.includes(diagnostic.file)
        )
          throw new Error('Diagnóstico fora do escopo informado')
      }
    }
    if (
      check.status === 'failed' &&
      check.cause === 'code' &&
      (!Array.isArray(check.diagnostics) || check.diagnostics.length === 0)
    )
      throw new Error('Falha de código sem diagnósticos novos')
    if (check.output !== undefined && (typeof check.output !== 'string' || check.output.length > 16_000))
      throw new Error('Saída do comando inválida')
    if (check.relevance !== undefined) {
      if (!check.relevance || typeof check.relevance !== 'object' || Array.isArray(check.relevance))
        throw new Error('Classificação de relevância inválida')
      const relevance = check.relevance as Record<string, unknown>
      if (!['relevant', 'ignored', 'pending'].includes(String(relevance.result)) || typeof relevance.reason !== 'string' || relevance.reason.length > 1000)
        throw new Error('Classificação de relevância inválida')
      if (check.status === 'ignored' && relevance.result !== 'ignored') throw new Error('Check ignorado sem classificação correspondente')
      if (relevance.result === 'pending' && check.status !== 'failed') throw new Error('Check pendente sem falha')
    }
    return {
      id: check.id,
      repo: check.repo,
      name: check.name,
      summary: check.summary,
      status: check.status as CheckStatus,
      ...(typeof check.cause === 'string' ? { cause: check.cause as VerificationCheck['cause'] } : {}),
      ...(Array.isArray(check.files) ? { files: check.files as string[] } : {}),
      ...(Array.isArray(check.diagnostics) ? { diagnostics: check.diagnostics as VerificationCheck['diagnostics'] } : {}),
      ...(typeof check.durationMs === 'number' ? { durationMs: check.durationMs } : {}),
      profileFingerprint: check.profileFingerprint,
      ...(typeof check.commandId === 'string' ? { commandId: check.commandId } : {}),
      ...(typeof check.output === 'string' ? { output: check.output } : {}),
      ...(check.relevance && typeof check.relevance === 'object' ? { relevance: check.relevance as VerificationCheck['relevance'] } : {}),
    }
  })
  let roundSummary: VerificationReport['roundSummary']
  if (value.roundSummary !== undefined) {
    if (!value.roundSummary || typeof value.roundSummary !== 'object' || Array.isArray(value.roundSummary))
      throw new Error('Resumo da rodada inválido')
    const summary = value.roundSummary as Record<string, unknown>
    const counts = summary.statusCounts
    const statuses: CheckStatus[] = ['passed', 'failed', 'skipped', 'environment', 'inconclusive', 'ignored']
    if (
      typeof summary.durationMs !== 'number' || !Number.isFinite(summary.durationMs) || summary.durationMs < 0 ||
      typeof summary.agentDurationMs !== 'number' || !Number.isFinite(summary.agentDurationMs) || summary.agentDurationMs < 0 ||
      (summary.agentCostUsd !== undefined && (typeof summary.agentCostUsd !== 'number' || !Number.isFinite(summary.agentCostUsd) || summary.agentCostUsd < 0)) ||
      typeof summary.repairsCreated !== 'number' || !Number.isInteger(summary.repairsCreated) || summary.repairsCreated < 0 ||
      typeof summary.repairsReused !== 'number' || !Number.isInteger(summary.repairsReused) || summary.repairsReused < 0 ||
      (summary.reviewerNote !== undefined && (typeof summary.reviewerNote !== 'string' || summary.reviewerNote.length > 4000)) ||
      !counts || typeof counts !== 'object' || Array.isArray(counts) ||
      statuses.some((status) => typeof (counts as Record<string, unknown>)[status] !== 'number' || !Number.isInteger((counts as Record<string, unknown>)[status]) || (counts as Record<string, number>)[status] < 0) ||
      Object.keys(counts as object).some((status) => !statuses.includes(status as CheckStatus)) ||
      statuses.reduce((total, status) => total + ((counts as Record<string, number>)[status] ?? 0), 0) !== checks.length
    ) throw new Error('Resumo da rodada inconsistente')
    roundSummary = {
      durationMs: summary.durationMs as number,
      agentDurationMs: summary.agentDurationMs as number,
      ...(typeof summary.agentCostUsd === 'number' ? { agentCostUsd: summary.agentCostUsd } : {}),
      repairsCreated: summary.repairsCreated as number,
      repairsReused: summary.repairsReused as number,
      statusCounts: Object.fromEntries(statuses.map((status) => [status, (counts as Record<string, number>)[status]])) as Record<CheckStatus, number>,
      ...(typeof summary.reviewerNote === 'string' ? { reviewerNote: summary.reviewerNote } : {}),
    }
  }
  return {
    schemaVersion: 1,
    profiles: [...expected.profiles].map(([repo, profile]) => ({ repo, fingerprint: profile.fingerprint, runtime: profile.runtime })),
    round: expected.round,
    checks,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : new Date().toISOString(),
    ...(roundSummary ? { roundSummary } : {}),
  }
}
