import type { ResolvedProjectRuntime } from './project-runtime.ts'

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'environment' | 'inconclusive' | 'ignored'
export type FailureCause = 'code' | 'environment' | 'resource' | 'configuration' | 'unknown'

export interface VerificationCommand {
  id: string
  argv: string[]
  cwd: string
  timeoutMs: number
  writeMode: 'read-only' | 'project'
  scope: 'card-files' | 'project'
  targets?: string[]
}

export interface VerificationCheck {
  id: string
  repo: string
  name: string
  status: CheckStatus
  cause?: FailureCause
  summary: string
  commandId?: string
  profileFingerprint: string
  files?: string[]
  diagnostics?: { file: string; rule: string; message: string }[]
  output?: string
  relevance?: { result: 'relevant' | 'ignored' | 'pending'; reason: string }
  durationMs?: number
}

export interface VerificationProfile {
  schemaVersion: 1
  repo: string
  fingerprint: string
  runtime: ResolvedProjectRuntime
  commands: VerificationCommand[]
  skipped: { id: string; reason: string }[]
  formatting: { mode: 'disabled' | 'whole-file'; reason?: string }
  createdAt: string
}

export interface VerificationReport {
  schemaVersion: 1
  profiles: { repo: string; fingerprint: string; runtime: ResolvedProjectRuntime }[]
  round: number
  checks: VerificationCheck[]
  roundSummary?: {
    durationMs: number
    agentDurationMs: number
    agentCostUsd?: number
    repairsCreated: number
    repairsReused: number
    statusCounts: Record<CheckStatus, number>
    reviewerNote?: string
  }
  generatedAt: string
}

export function isRepairableCheck(check: VerificationCheck): boolean {
  return check.status === 'failed' && (
    (check.cause === 'code' && Boolean(check.files?.length && check.diagnostics?.length)) ||
    (check.relevance?.result === 'relevant' && Boolean(check.commandId && check.files?.length))
  )
}
