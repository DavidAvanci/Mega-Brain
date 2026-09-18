import { readFileSync } from 'node:fs'
import { blockedByDeps, markItem, parseChecklist, ready, widenFiles, type Item, type ItemState } from './checklist.ts'
import { activity } from './log.ts'

export interface ItemOutcome {
  status: ItemState
  note: string
  costUsd?: number
  durationMs?: number
  widen?: string[]
}

export interface SchedulerOptions {
  file: string
  max: number
  execute: (item: Item) => Promise<ItemOutcome>
  afterDone?: (item: Item, othersInRepo: Item[]) => Promise<ItemOutcome | null> | ItemOutcome | null
}

export interface SchedulerSummary {
  done: number
  failed: number
  blocked: number
  total: number
  ok: boolean
  costUsd: number
  durationMs: number
  failures: { id: string; note: string }[]
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (!minutes) return `${seconds}s`
  return seconds ? `${minutes}min ${seconds}s` : `${minutes}min`
}

function usageNote(usage: { costUsd?: number; durationMs?: number }): string {
  const parts: string[] = []
  if (usage.durationMs !== undefined) parts.push(`Tempo: ${formatDuration(usage.durationMs)}`)
  if (usage.costUsd !== undefined) parts.push(`Custo: $${usage.costUsd.toFixed(2)}`)
  return parts.join(' · ')
}

export async function runChecklist(options: SchedulerOptions): Promise<SchedulerSummary> {
  const runningIds = new Set<string>()
  const runningItems = new Map<string, Item>()
  const inFlight = new Map<string, Promise<void>>()
  let writeLock = Promise.resolve()
  let totalCostUsd = 0
  let totalDurationMs = 0
  const failures: { id: string; note: string }[] = []

  const start = (item: Item) => {
    runningIds.add(item.id)
    runningItems.set(item.id, item)
    activity('Item', `${item.id} ${item.text}`.slice(0, 120))
    const promise = (async () => {
      let result: ItemOutcome
      let costUsd = 0
      let durationMs = 0
      const absorb = (outcome: ItemOutcome) => {
        costUsd += outcome.costUsd ?? 0
        durationMs += outcome.durationMs ?? 0
        return outcome
      }
      try {
        result = absorb(await options.execute(item))
      } catch (error) {
        result = { status: 'failed', note: error instanceof Error ? error.message : String(error) }
      }
      if (result.status === 'done' && options.afterDone) {
        const others = [...runningItems.values()].filter(
          (other) => other.id !== item.id && other.repo === item.repo,
        )
        try {
          const adjusted = await options.afterDone(item, others)
          if (adjusted) result = absorb(adjusted)
        } catch (error) {
          result = { status: 'failed', note: error instanceof Error ? error.message : String(error) }
        }
      }
      totalCostUsd += costUsd
      totalDurationMs += durationMs
      const usage = usageNote({ costUsd: costUsd || undefined, durationMs: durationMs || undefined })
      if (usage) activity('Item', `${item.id} ${result.status} — ${usage}`)
      writeLock = writeLock.then(() => {
        if (result.widen?.length) widenFiles(options.file, item, result.widen)
        if (result.status !== 'done' && result.note) failures.push({ id: item.id, note: result.note })
        markItem(options.file, item, result.status, [result.note, usage].filter(Boolean).join('\n') || undefined)
      })
      await writeLock
    })().finally(() => {
      runningIds.delete(item.id)
      runningItems.delete(item.id)
      inFlight.delete(item.id)
    })
    inFlight.set(item.id, promise)
  }

  for (;;) {
    await writeLock
    const items = parseChecklist(readFileSync(options.file, 'utf8'))
    while (runningIds.size < options.max) {
      const [next] = ready(items, runningIds)
      if (!next) break
      start(next)
    }
    if (!inFlight.size) break
    await Promise.race(inFlight.values())
  }

  await writeLock
  let items = parseChecklist(readFileSync(options.file, 'utf8'))
  for (const [id, culprit] of blockedByDeps(items)) {
    const item = items.find((entry) => entry.id === id)
    if (item) markItem(options.file, item, 'blocked', `Bloqueado: depende de ${culprit}, que não concluiu.`)
    items = parseChecklist(readFileSync(options.file, 'utf8'))
  }

  const final = parseChecklist(readFileSync(options.file, 'utf8'))
  const count = (state: ItemState) => final.filter((item) => item.state === state).length
  return {
    done: count('done'),
    failed: count('failed'),
    blocked: count('blocked'),
    total: final.length,
    ok: final.length > 0 && final.every((item) => item.state === 'done'),
    costUsd: totalCostUsd,
    durationMs: totalDurationMs,
    failures,
  }
}
