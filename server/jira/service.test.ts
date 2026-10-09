import { expect, test, vi } from 'vitest'
import { createJiraService } from './service'

test('recent Jira statuses stay cached while evicted or expired issues are fetched again', async () => {
  let now = 0
  const request = vi.fn(async () => Response.json({ fields: { status: { name: 'In Progress' } } }))
  const service = createJiraService({ site: 'fixture', email: 'fixture', token: 'fixture' }, request, {
    clock: { now: () => now },
  })
  await service.statuses('TEST-1')
  expect(await service.statuses('TEST-1')).toEqual({ 'TEST-1': 'In Progress' })
  expect(request).toHaveBeenCalledTimes(1)
  await service.statuses(Array.from({ length: 1000 }, (_, i) => `TEST-${i + 2}`).join(','))
  expect(await service.statuses('TEST-1')).toEqual({ 'TEST-1': 'In Progress' })
  expect(request).toHaveBeenCalledTimes(1002)
  now = 60_001
  await service.statuses('TEST-1')
  expect(request).toHaveBeenCalledTimes(1003)
})
