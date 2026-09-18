import { expect, test } from 'vitest'
import { createClaudeUsageService } from './claude-usage/service'
import { createJiraService } from './jira/service'

function fakeClock(initial = 1_000) {
  let time = initial
  return { now: () => time, advance: (milliseconds: number) => { time += milliseconds } }
}

test('Claude usage cache uses injected credentials reader and clock', async () => {
  const clock = fakeClock()
  let reads = 0
  let requests = 0
  const service = createClaudeUsageService('/not-a-real-credential-file', async () => {
    requests++
    return new Response(JSON.stringify({ five_hour: { utilization: 12, resets_at: 'later' } }))
  }, {
    clock,
    files: { readText: () => { reads++; return JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-token' } }) } },
  })

  await expect(service.getUsage()).resolves.toMatchObject({ fiveHour: { utilization: 12 } })
  await service.getUsage()
  expect({ reads, requests }).toEqual({ reads: 1, requests: 1 })
  clock.advance(60_000)
  await service.getUsage()
  expect({ reads, requests }).toEqual({ reads: 2, requests: 2 })
})

test('Jira status cache expires deterministically without a real clock', async () => {
  const clock = fakeClock()
  let requests = 0
  const service = createJiraService({ site: 'example', email: 'a', token: 'b' }, async () => {
    requests++
    return new Response(JSON.stringify({ fields: { status: { name: 'Ready' } } }))
  }, { clock })

  await service.statuses('ABC-1')
  await service.statuses('ABC-1')
  expect(requests).toBe(1)
  clock.advance(60_000)
  await service.statuses('ABC-1')
  expect(requests).toBe(2)
})
