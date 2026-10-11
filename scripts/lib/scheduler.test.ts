import { checklistJson } from "../../test/checklist-fixtures"
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseChecklist } from './checklist'
import { runChecklist } from './scheduler'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function tempChecklist(content: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'sched-')), 'TASK-CHECKLIST.json')
  writeFileSync(file, content)
  return file
}

test('runs items respecting deps and marks results', async () => {
  const file = tempChecklist(
    checklistJson([{"id":"T1","title":"Primeiro","repo":"repo-a","files":["a.ts"]},{"id":"T2","title":"Segundo","repo":"repo-a","files":["b.ts"],"deps":["T1"]},{"id":"T3","title":"Independente","repo":"repo-a","files":["c.ts"]}]),
  )
  const order: string[] = []
  const summary = await runChecklist({
    file,
    max: 4,
    execute: async (item) => {
      order.push(item.id)
      await sleep(10)
      return { status: item.id === 'T3' ? 'failed' : 'done', note: item.id === 'T3' ? 'quebrou' : '' }
    },
  })
  expect(order.indexOf('T2')).toBeGreaterThan(order.indexOf('T1'))
  expect(summary).toMatchObject({ done: 2, failed: 1, blocked: 0, total: 3, ok: false })
  expect(summary.failures).toEqual([{ id: 'T3', note: 'quebrou' }])
  const final = readFileSync(file, 'utf8')
  expect(parseChecklist(final).find((item) => item.id === 'T1')?.state).toBe('done')
  expect(parseChecklist(final).find((item) => item.id === 'T3')).toMatchObject({ state: 'failed', notes: ['quebrou'] })
})

test('coordena dependências entre repositórios do mesmo workspace', async () => {
  const file = tempChecklist(checklistJson([{"id":"BE1","title":"Criar contrato","repo":"takeat-platform","files":["src/api.ts"]},{"id":"DOC1","title":"Documentar contrato","repo":"external-api-docs","files":["content/api.mdx"],"deps":["BE1"]}]))
  const executed: string[] = []
  const summary = await runChecklist({ file, max: 4, execute: async item => {
    if (item.id === 'DOC1') expect(executed).toEqual(['takeat-platform:BE1'])
    executed.push(`${item.repo}:${item.id}`)
    return { status: 'done' as const, note: 'Validado' }
  } })
  expect(executed).toEqual(['takeat-platform:BE1', 'external-api-docs:DOC1'])
  expect(summary.done).toBe(2)
})

test('marks dependents of failures as blocked', async () => {
  const file = tempChecklist(checklistJson([{"id":"T1","title":"Base","repo":"repo","files":["a.ts"]},{"id":"T2","title":"Dependente","repo":"repo","files":["b.ts"],"deps":["T1"]}]))
  const summary = await runChecklist({
    file,
    max: 2,
    execute: async () => ({ status: 'failed', note: 'erro' }),
  })
  expect(summary).toMatchObject({ failed: 1, blocked: 1, ok: false })
  const items = parseChecklist(readFileSync(file, 'utf8'))
  expect(items.find((item) => item.id === 'T2')?.state).toBe('blocked')
})

test('serializes overlapping items and parallelizes disjoint ones', async () => {
  const file = tempChecklist(
    checklistJson([{"id":"T1","title":"Um","repo":"repo","files":["x/*"]},{"id":"T2","title":"Dois","repo":"repo","files":["x/y.ts"]},{"id":"T3","title":"Tres","repo":"repo","files":["z.ts"]}]),
  )
  let concurrent = 0
  let maxConcurrent = 0
  const active = new Set<string>()
  const overlapTogether: boolean[] = []
  await runChecklist({
    file,
    max: 4,
    execute: async (item) => {
      concurrent++
      active.add(item.id)
      overlapTogether.push(active.has('T1') && active.has('T2'))
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await sleep(20)
      active.delete(item.id)
      concurrent--
      return { status: 'done', note: '' }
    },
  })
  expect(maxConcurrent).toBeGreaterThan(1)
  expect(overlapTogether.every((flag) => !flag)).toBe(true)
})

test('afterDone can downgrade a result', async () => {
  const file = tempChecklist(checklistJson([{"id":"T1","title":"Item","repo":"repo","files":["a.ts"]}]))
  const summary = await runChecklist({
    file,
    max: 1,
    execute: async () => ({ status: 'done', note: '' }),
    afterDone: () => ({ status: 'failed', note: 'fora do contrato' }),
  })
  expect(summary.failed).toBe(1)
  expect(readFileSync(file, 'utf8')).toContain('fora do contrato')
})

test('records cost and duration per item and totals in summary', async () => {
  const file = tempChecklist(checklistJson([{"id":"T1","title":"Um","repo":"repo","files":["a.ts"]},{"id":"T2","title":"Dois","repo":"repo","files":["b.ts"]}]))
  const summary = await runChecklist({
    file,
    max: 2,
    execute: async () => ({ status: 'done', note: '', costUsd: 0.5, durationMs: 65_000 }),
  })
  expect(summary.costUsd).toBeCloseTo(1)
  expect(summary.durationMs).toBe(130_000)
  expect(parseChecklist(readFileSync(file, 'utf8'))[0].notes).toContain('Tempo: 1min 5s · Custo: $0.50')
})

test('empty checklist is not ok', async () => {
  const file = tempChecklist(JSON.stringify({ schemaVersion: 1, items: [] }))
  const summary = await runChecklist({ file, max: 2, execute: async () => ({ status: 'done', note: '' }) })
  expect(summary.ok).toBe(false)
})
