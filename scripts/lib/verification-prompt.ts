import type { VerificationCheck, VerificationProfile } from '../../shared/domain/verification.ts'
import { megaBrainPrompt } from './prompts.ts'

export interface VerificationPromptContext {
  round: number
  projects: { repo: string; path: string; baseRef: string; files: string[]; renamed: { from: string; to: string }[] }[]
  profiles: Map<string, VerificationProfile>
  checks: VerificationCheck[]
  previousChecks: VerificationCheck[]
  waveNotes: { id: string; state: string; note: string }[]
}

function redact(value: string, limit = 1000): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*=\s*[^\s]+/gi, '$1=[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted AWS key]')
    .slice(0, limit)
}

export function applyProjectCheckRelevance(checks: VerificationCheck[], response: string): VerificationCheck[] {
  const candidates = checks.filter((check) => check.relevance?.result === 'pending')
  if (!candidates.length) return checks
  let parsed: unknown
  try { parsed = JSON.parse(response) } catch { return checks }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { checks?: unknown }).checks)) return checks
  const decisions = new Map<string, { result: 'relevant' | 'ignored'; reason: string }>()
  for (const entry of (parsed as { checks: unknown[] }).checks) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    if (typeof value.repo !== 'string' || typeof value.id !== 'string' || !['relevant', 'ignored'].includes(String(value.result)) || typeof value.reason !== 'string') continue
    decisions.set(`${value.repo}\0${value.id}`, { result: value.result as 'relevant' | 'ignored', reason: value.reason.trim().slice(0, 1000) })
  }
  return checks.map((check) => {
    if (check.relevance?.result !== 'pending') return check
    const decision = decisions.get(`${check.repo}\0${check.id}`)
    if (!decision?.reason) return check
    return decision.result === 'ignored'
      ? { ...check, status: 'ignored', cause: undefined, summary: decision.reason, relevance: { result: 'ignored', reason: decision.reason } }
      : { ...check, status: 'failed', cause: 'unknown', summary: decision.reason, relevance: { result: 'relevant', reason: decision.reason } }
  })
}

export function verificationPrompt(context: VerificationPromptContext): string {
  const profiles = [...context.profiles.values()].map((profile) => ({
    repo: profile.repo,
    fingerprint: profile.fingerprint,
    runtime: profile.runtime,
    commands: profile.commands.map(({ id, argv, scope }) => ({ id, argv, scope })),
    skipped: profile.skipped,
  }))
  const checks = context.checks.map((check) => ({
    ...check,
    summary: redact(check.summary),
    ...(check.output ? { output: redact(check.output, 12_000) } : {}),
    diagnostics: check.diagnostics?.slice(0, 50).map((diagnostic) => ({ ...diagnostic, message: redact(diagnostic.message) })),
  }))
  const previousChecks = context.previousChecks.slice(0, 100).map((check) => ({
    repo: check.repo,
    id: check.id,
    status: check.status,
    cause: check.cause,
    summary: redact(check.summary),
  }))
  const waveNotes = context.waveNotes.slice(0, 100).map((entry) => ({ ...entry, note: redact(entry.note) }))
  const evidence = JSON.stringify({
    round: context.round,
    projects: context.projects,
    profiles,
    checks,
    baselineAndRunnerEvidence: checks.map((check) => ({
      repo: check.repo,
      checkId: check.commandId ?? check.id,
      outcome: check.summary,
      cause: check.cause,
      status: check.status,
    })),
    previousChecks,
    waveNotes,
  }).slice(0, 40_000)
  return [
    megaBrainPrompt('taskVerification'),
    `Papel: Verificador · Rodada ${context.round}. Faça somente uma leitura crítica da evidência estruturada abaixo.`,
    'Não execute comandos nem altere arquivos. Para cada check de escopo project que falhou e está com relevance=pending, analise a saída do comando, os arquivos alterados do card e o código atual. Responda SOMENTE JSON válido: {"checks":[{"repo":"alias","id":"check-id","result":"relevant","reason":"justificativa curta baseada na saída"}]}; result aceita somente "relevant" ou "ignored". Inclua todos os checks pendentes exatamente uma vez. Marque ignored apenas quando houver evidência clara de que a falha não tem relação com as mudanças do card. Se não for possível concluir com segurança, marque relevant para bloquear e explicar. Não classifique checks que já tenham resultado definitivo. Checks disponíveis são exclusivamente os IDs declarados nos perfis; a execução é responsabilidade do scheduler.',
    'Perfis, runtimes, diffs do card, checks e baseline atual; depois checks e notas blocked/failed das levas anteriores:',
    evidence,
  ].join('\n\n')
}
