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
  let cached: { value: ClaudeUsage; expires: number } | undefined
  return {
    async getUsage() {
      if (cached && cached.expires > clock.now()) return cached.value
      let token: unknown
      try {
        token = JSON.parse(files.readText(credentialsFile))?.claudeAiOauth?.accessToken
      } catch {}
      let value = EMPTY
      if (typeof token === 'string' && token) {
        try {
          const response = await request('https://api.anthropic.com/api/oauth/usage', {
            headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
          })
          if (response.ok) value = parseUsage(await response.json())
        } catch {}
      }
      cached = { value, expires: clock.now() + 60_000 }
      return value
    },
  }
}
