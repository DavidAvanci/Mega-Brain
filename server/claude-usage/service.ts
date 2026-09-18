import { readFileSync } from 'node:fs'
import type { ClaudeUsage, UsageWindow } from '../../src/types'
import { systemClock, type Clock, type TextFileReader } from '../system'
const EMPTY: ClaudeUsage = { fiveHour: null, sevenDay: null, fable: null }
function window(value: unknown): UsageWindow | null { if (!value || typeof value !== 'object') return null; const v = value as { utilization?: unknown; resets_at?: unknown }; return typeof v.utilization === 'number' ? { utilization: v.utilization, resetsAt: typeof v.resets_at === 'string' ? v.resets_at : null } : null }
export function parseUsage(data: unknown): ClaudeUsage { if (!data || typeof data !== 'object') return EMPTY; const d = data as Record<string, unknown>; const limit = Array.isArray(d.limits) ? d.limits.find((x: any) => x?.scope?.model?.display_name === 'Fable') as any : undefined; return { fiveHour: window(d.five_hour), sevenDay: window(d.seven_day), fable: limit && typeof limit.percent === 'number' ? { utilization: limit.percent, resetsAt: typeof limit.resets_at === 'string' ? limit.resets_at : null } : null } }
export interface ClaudeUsageService { getUsage(): Promise<ClaudeUsage> }

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
      try { token = JSON.parse(files.readText(credentialsFile))?.claudeAiOauth?.accessToken } catch {}
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
