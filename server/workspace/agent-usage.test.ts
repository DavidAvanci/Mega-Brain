import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { claudeCostFromStream, finishAgentUsage, readAgentUsage, startAgentUsage } from './agent-usage'

const folders: string[] = []
function cardPath(): string {
  const path = mkdtempSync(join(tmpdir(), 'agent-usage-'))
  folders.push(path)
  return path
}

afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true })
})

test('sums concurrent completed and running agent executions without losing partial costs', () => {
  const path = cardPath()
  const first = startAgentUsage(path, new Date('2026-01-01T00:00:00Z'))
  const second = startAgentUsage(path, new Date('2026-01-01T00:00:10Z'))
  finishAgentUsage(path, first, 0.42, new Date('2026-01-01T00:00:30Z'))

  expect(readAgentUsage(path, new Date('2026-01-01T00:00:40Z'))).toEqual({
    durationMs: 60_000,
    costUsd: 0.42,
    runs: 2,
    unpricedRuns: 1,
  })
  finishAgentUsage(path, second, undefined, new Date('2026-01-01T00:00:50Z'))
  finishAgentUsage(path, first, 99, new Date('2026-01-01T00:01:00Z'))
  expect(readAgentUsage(path).durationMs).toBe(70_000)
  expect(readAgentUsage(path).costUsd).toBe(0.42)
})

test('reads the final Claude result cost from a stream', () => {
  const path = cardPath()
  const stream = join(path, 'planning.jsonl')
  writeFileSync(stream, '{"type":"assistant","total_cost_usd":9}\n{"type":"result","total_cost_usd":0.125}\n')
  expect(claudeCostFromStream(readFileSync(stream, 'utf8'))).toBe(0.125)
})
