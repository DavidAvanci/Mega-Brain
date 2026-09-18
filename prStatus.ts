import type { PrState } from './src/types'
import { nodeProcessRunner, type ProcessRunner } from './server/process'

const OPEN_TTL_MS = 60_000

function ghPrState(url: string, runner: ProcessRunner = nodeProcessRunner): Promise<PrState | undefined> {
  return new Promise((resolve) => {
    runner.execFile('gh', ['pr', 'view', url, '--json', 'state', '-q', '.state'], { timeout: 15_000 }, (error, stdout) => {
      const state = stdout?.trim().toLowerCase()
      if (error || (state !== 'open' && state !== 'merged' && state !== 'closed')) return resolve(undefined)
      resolve(state)
    })
  })
}

interface CacheEntry {
  state?: PrState
  checkedAt: number
  pending: boolean
}

export function createPrTracker(fetchState: (url: string) => Promise<PrState | undefined> = ghPrState) {
  const cache = new Map<string, CacheEntry>()
  return (urls: string[], now = Date.now()): Record<string, PrState> => {
    const states: Record<string, PrState> = {}
    for (const url of urls) {
      if (!/^https?:\/\//.test(url)) continue
      const entry = cache.get(url)
      if (entry?.state) states[url] = entry.state
      const settled = entry?.state === 'merged' || entry?.state === 'closed'
      if (entry && (entry.pending || settled || now - entry.checkedAt < OPEN_TTL_MS)) continue
      cache.set(url, { state: entry?.state, checkedAt: now, pending: true })
      fetchState(url).then((state) => {
        cache.set(url, { state: state ?? entry?.state, checkedAt: now, pending: false })
      })
    }
    return states
  }
}

export const prStates = createPrTracker()
