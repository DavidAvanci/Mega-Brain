import { readFileSync } from 'node:fs'
import type { ClaudeUsage, UsageWindow } from '../../shared/contracts/usage'
import { systemClock, type Clock, type TextFileReader } from '../system'
const EMPTY: ClaudeUsage = { fiveHour: null, sevenDay: null, fable: null }
function window(value: unknown): UsageWindow | null {
  if (!value || typeof value !== 'object') return null
  const v = value as { utilization?: unknown; resets_at?: unknown }
  return typeof v.utilization === 'number'
    ? { utilization: v.utilization, resetsAt: typeof v.resets_at === 'string' ? v.resets_at : null }
    : null
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}
function fableLimit(value: unknown): UsageWindow | null {
  if (!Array.isArray(value)) return null
  const limit = value.map(record).find((entry) => {
    const scope = record(entry?.scope)
    const model = record(scope?.model)
    return model?.display_name === 'Fable'
  })
  return limit && typeof limit.percent === 'number'
    ? { utilization: limit.percent, resetsAt: typeof limit.resets_at === 'string' ? limit.resets_at : null }
    : null
}
export function parseUsage(data: unknown): ClaudeUsage {
  const parsed = record(data)
  if (!parsed) return EMPTY
  return { fiveHour: window(parsed.five_hour), sevenDay: window(parsed.seven_day), fable: fableLimit(parsed.limits) }
}
export interface ClaudeUsageService {
  getUsage(): Promise<ClaudeUsage>
}

export interface ClaudeUsageDependencies {
  clock?: Clock
  warn?: (message: string) => void
  files?: TextFileReader
}

const nodeTextFiles: TextFileReader = { readText: (path) => readFileSync(path, 'utf8') }

/** Credentials and cache time are injectable so tests never read ~/.claude. */
export function createClaudeUsageService(
  credentialsFile: string,
  request: typeof fetch = fetch,
  dependencies: ClaudeUsageDependencies = {},
): ClaudeUsageService {
  const clock = dependencies.clock ?? systemClock
  const files = dependencies.files ?? nodeTextFiles
  const warn = dependencies.warn ?? console.warn
  let cached: { value: ClaudeUsage; expires: number } | undefined
  let lastSuccess: ClaudeUsage | undefined
  let pending: Promise<ClaudeUsage> | undefined

  async function refresh(): Promise<ClaudeUsage> {
    let failure = 'credentials_unreadable'
    let value: ClaudeUsage | undefined
    let token: unknown
    try {
      token = JSON.parse(files.readText(credentialsFile))?.claudeAiOauth?.accessToken
      failure = 'credentials_missing_token'
    } catch {
      // Report only a safe reason, never credentials or response bodies.
    }
    if (typeof token === 'string' && token) {
      failure = 'network_or_timeout'
      try {
        const response = await request('https://api.anthropic.com/api/oauth/usage', {
          headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
          signal: AbortSignal.timeout(10_000),
        })
        failure = `http_${response.status}`
        if (response.ok) {
          failure = 'invalid_response'
          const parsed = parseUsage(await response.json())
          if (parsed.fiveHour || parsed.sevenDay || parsed.fable) {
            value = { ...parsed, stale: false, updatedAt: new Date(clock.now()).toISOString() }
            lastSuccess = value
          }
        }
      } catch {
        // The reason above identifies the stage that failed.
      }
    }
    if (!value) {
      warn(`[claude-usage] Refresh failed: ${failure}`)
      value = { ...(lastSuccess ?? EMPTY), stale: true, updatedAt: lastSuccess?.updatedAt ?? null }
    }
    cached = { value, expires: clock.now() + 60_000 }
    return value
  }

  return {
    async getUsage() {
      if (cached && cached.expires > clock.now()) return cached.value
      pending ??= refresh().finally(() => {
        pending = undefined
      })
      return pending
    },
  }
}
