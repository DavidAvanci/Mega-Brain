import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AgentProvider, CardAgentUsage, CardAgentUsageEntry } from '../../shared/domain/agents'

const DIRECTORY = 'agent-usage'

interface Run {
  id: string
  label?: string
  provider?: AgentProvider
  model?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  costUsd?: number
  pid?: number
  stream?: string
}

export interface AgentUsageMetadata {
  label?: string
  provider?: AgentProvider
  model?: string
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function fileFor(cardPath: string, id: string): string {
  return join(cardPath, DIRECTORY, `${id}.json`)
}

function save(cardPath: string, run: Run): void {
  const file = fileFor(cardPath, run.id)
  mkdirSync(join(cardPath, DIRECTORY), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(run)}\n`)
  renameSync(temporary, file)
}

export function startAgentUsage(cardPath: string, startedAt = new Date(), metadata: AgentUsageMetadata = {}): string {
  const id = randomUUID()
  save(cardPath, {
    id,
    startedAt: startedAt.toISOString(),
    ...(metadata.label ? { label: metadata.label } : {}),
    ...(metadata.provider ? { provider: metadata.provider } : {}),
    ...(metadata.model ? { model: metadata.model } : {}),
  })
  return id
}

export function setAgentUsageProcess(cardPath: string, id: string, pid: number | undefined, stream: string): void {
  if (!pid) return
  const file = fileFor(cardPath, id)
  try {
    const run = JSON.parse(readFileSync(file, 'utf8')) as Run
    save(cardPath, { ...run, pid, stream })
  } catch {}
}

export function finishAgentUsage(cardPath: string, id: string, costUsd?: number, finishedAt = new Date()): void {
  const file = fileFor(cardPath, id)
  if (!existsSync(file)) return
  try {
    const run = JSON.parse(readFileSync(file, 'utf8')) as Run
    if (run.finishedAt) return
    const durationMs = Math.max(0, finishedAt.getTime() - Date.parse(run.startedAt))
    save(cardPath, {
      ...run,
      finishedAt: finishedAt.toISOString(),
      durationMs: Number.isFinite(durationMs) ? durationMs : 0,
      ...(validNumber(costUsd) ? { costUsd } : {}),
    })
  } catch {
    // A missing or malformed run must not prevent the agent from finishing.
  }
}

export function readAgentUsageDetails(
  cardPath: string,
  now = new Date(),
): { usage: CardAgentUsage; breakdown: CardAgentUsageEntry[] } {
  let names: string[]
  try {
    names = readdirSync(join(cardPath, DIRECTORY)).filter((name) => /^[a-f0-9-]+\.json$/.test(name))
  } catch {
    return { usage: { durationMs: 0, costUsd: 0, runs: 0, unpricedRuns: 0 }, breakdown: [] }
  }
  const usage: CardAgentUsage = { durationMs: 0, costUsd: 0, runs: 0, unpricedRuns: 0 }
  const breakdown: CardAgentUsageEntry[] = []
  for (const name of names) {
    try {
      let run = JSON.parse(readFileSync(join(cardPath, DIRECTORY, name), 'utf8')) as Run
      if (!run.finishedAt && run.pid && run.stream) {
        let alive = false
        try {
          process.kill(run.pid, 0)
          alive = true
        } catch {}
        if (!alive) {
          let cost: number | undefined
          let finishedAt = now
          try {
            cost = claudeCostFromStream(readFileSync(run.stream, 'utf8'))
            finishedAt = new Date(statSync(run.stream).mtimeMs)
          } catch {}
          finishAgentUsage(cardPath, run.id, cost, finishedAt)
          run = JSON.parse(readFileSync(join(cardPath, DIRECTORY, name), 'utf8')) as Run
        }
      }
      const started = Date.parse(run.startedAt)
      if (!Number.isFinite(started)) continue
      const durationMs = validNumber(run.durationMs)
        ? run.durationMs
        : Math.max(0, (run.finishedAt ? Date.parse(run.finishedAt) : now.getTime()) - started)
      usage.runs++
      usage.durationMs += durationMs
      if (validNumber(run.costUsd)) usage.costUsd += run.costUsd
      else usage.unpricedRuns++
      breakdown.push({
        id: run.id,
        ...(typeof run.label === 'string' && run.label.trim() ? { label: run.label.trim() } : {}),
        ...(run.provider === 'claude' || run.provider === 'codex' ? { provider: run.provider } : {}),
        ...(typeof run.model === 'string' && run.model.trim() ? { model: run.model.trim() } : {}),
        startedAt: run.startedAt,
        ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
        durationMs,
        ...(validNumber(run.costUsd) ? { costUsd: run.costUsd } : {}),
      })
    } catch {
      // Ignore incomplete records while another process atomically replaces them.
    }
  }
  breakdown.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
  return { usage, breakdown }
}

export function readAgentUsage(cardPath: string, now = new Date()): CardAgentUsage {
  return readAgentUsageDetails(cardPath, now).usage
}

export function claudeCostFromStream(text: string): number | undefined {
  let cost: number | undefined
  for (const line of text.split('\n')) {
    try {
      const event = JSON.parse(line) as { type?: string; total_cost_usd?: unknown }
      if (event.type === 'result' && validNumber(event.total_cost_usd)) cost = event.total_cost_usd
    } catch {}
  }
  return cost
}
