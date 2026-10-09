import type { PrState } from '../../shared/domain/cards'
import { BoundedCache } from '../../shared/lib/bounded-cache'
import { nodeProcessRunner, type ProcessRunner } from '../process'

const OPEN_TTL_MS = 60_000
const CACHE_IDLE_MS = 24 * 60 * 60 * 1000

function ghPrState(url: string, runner: ProcessRunner = nodeProcessRunner): Promise<PrState | undefined> {
  return new Promise((resolve) => {
    runner.execFile(
      'gh',
      ['pr', 'view', url, '--json', 'state', '-q', '.state'],
      { timeout: 15_000 },
      (error, stdout) => {
        const state = stdout?.trim().toLowerCase()
        if (error || (state !== 'open' && state !== 'merged' && state !== 'closed')) return resolve(undefined)
        resolve(state)
      },
    )
  })
}

interface CacheEntry {
  state?: PrState
  checkedAt: number
  accessedAt: number
}

export function createPrTracker(fetchState: (url: string) => Promise<PrState | undefined> = ghPrState) {
  const cache = new BoundedCache<string, CacheEntry>(1000)
  // Active requests must not be evicted: that would allow duplicate lookups.
  const pending = new Set<string>()
  return (urls: string[], now = Date.now()): Record<string, PrState> => {
    cache.prune((entry) => now - entry.accessedAt >= CACHE_IDLE_MS)
    const states: Record<string, PrState> = {}
    for (const url of urls) {
      if (!/^https?:\/\//.test(url)) continue
      const entry = cache.get(url)
      if (entry) entry.accessedAt = now
      if (entry?.state) states[url] = entry.state
      const settled = entry?.state === 'merged' || entry?.state === 'closed'
      if (pending.has(url) || (entry && (settled || now - entry.checkedAt < OPEN_TTL_MS))) continue
      pending.add(url)
      void fetchState(url)
        .catch(() => undefined)
        .then((state) => {
          cache.set(url, { state: state ?? entry?.state, checkedAt: now, accessedAt: now })
          pending.delete(url)
        })
    }
    return states
  }
}

export const prStates = createPrTracker()
