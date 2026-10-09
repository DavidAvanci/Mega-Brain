import { createInterface } from 'node:readline'
import { codexBin } from '../agent-executable'
import { nodeProcessRunner, type ProcessOwner, type ProcessRunner } from '../process'
import type { ClaudeUsage, UsageWindow } from '../../shared/contracts/usage'
const EMPTY: ClaudeUsage = { fiveHour: null, sevenDay: null, fable: null }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
export function parseCodexUsage(value: unknown): ClaudeUsage {
  const data = record(value)
  const buckets = record(data.rateLimitsByLimitId)
  const limits = record(buckets.codex ?? data.rateLimits)
  let fiveHour: UsageWindow | null = null
  let sevenDay: UsageWindow | null = null
  for (const raw of [limits.primary, limits.secondary]) {
    const item = record(raw)
    if (typeof item.usedPercent !== 'number' || !Number.isFinite(item.usedPercent)) continue
    const resets = typeof item.resetsAt === 'number' ? item.resetsAt * 1000 : NaN
    const window = {
      utilization: Math.max(0, Math.min(100, item.usedPercent)),
      resetsAt: Number.isFinite(resets) && Math.abs(resets) < 8.64e15 ? new Date(resets).toISOString() : null,
    }
    if (item.windowDurationMins === 300) fiveHour = window
    if (item.windowDurationMins === 10080) sevenDay = window
  }
  return { fiveHour, sevenDay, fable: null }
}
export function createCodexUsageService(
  executable?: string,
  home?: string,
  runner: ProcessRunner = nodeProcessRunner,
  owner?: ProcessOwner,
) {
  let cached: ClaudeUsage | undefined
  let expires = 0
  let pending: Promise<ClaudeUsage> | undefined
  const read = async (): Promise<ClaudeUsage> => {
    let value = EMPTY
    try {
      const child = runner.spawn(codexBin(executable), ['app-server'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...(home ? { CODEX_HOME: home } : {}) },
      })
      owner?.own(child, { label: 'codex-usage' })
      const lines = createInterface({ input: child.stdout! })
      try {
        value = await new Promise<ClaudeUsage>((resolve) => {
          let settled = false
          const finish = (result = EMPTY) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(result)
          }
          const timer = setTimeout(() => finish(), 10_000)
          const send = (packet: unknown) => {
            if (!child.stdin?.destroyed) child.stdin?.write(JSON.stringify(packet) + '\n')
          }
          child.on('error', () => finish())
          child.on('exit', () => finish())
          child.stdin?.on('error', () => finish())
          lines.on('line', (line) => {
            try {
              const packet = record(JSON.parse(line))
              if (packet.id === 0) {
                if (packet.error) return finish()
                send({ method: 'initialized' })
                send({ id: 1, method: 'account/rateLimits/read', params: {} })
              }
              if (packet.id === 1) finish(parseCodexUsage(packet.result))
            } catch {
              /* Ignore unrelated malformed notifications. */
            }
          })
          send({
            id: 0,
            method: 'initialize',
            params: { clientInfo: { name: 'mega_brain_usage', title: 'Mega Brain', version: '0.1.0' } },
          })
        })
      } finally {
        lines.close()
        child.stdin?.end()
        child.kill('SIGTERM')
      }
    } catch {
      /* Return a stale reading without logging credentials or provider responses. */
    }
    const available = Boolean(value.fiveHour || value.sevenDay)
    cached = available
      ? { ...value, stale: false, updatedAt: new Date().toISOString() }
      : { ...(cached ?? EMPTY), stale: true, updatedAt: cached?.updatedAt ?? null }
    expires = Date.now() + 60_000
    return cached
  }
  return {
    async getUsage(): Promise<ClaudeUsage> {
      if (cached && Date.now() < expires) return cached
      pending ??= read().finally(() => {
        pending = undefined
      })
      return pending
    },
  }
}
