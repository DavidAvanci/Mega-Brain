import { expect, test, vi } from 'vitest'
import { createClaudeUsageService } from './service'

const credentials = { readText: () => JSON.stringify({ claudeAiOauth: { accessToken: 'secret-token' } }) }
const valid = (utilization: number) => new Response(JSON.stringify({ five_hour: { utilization } }))

test.each(['http', 'network', 'invalid', 'empty', 'credentials'])('retains last reading after %s failure and recovers', async (failure) => {
  let time = 1_000
  const files = { readText: vi.fn(credentials.readText) }
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(valid(12))
  const warn = vi.fn()
  const service = createClaudeUsageService('credentials', request, { files, clock: { now: () => time }, warn })
  const first = await service.getUsage()
  expect(first).toMatchObject({ fiveHour: { utilization: 12 }, stale: false, updatedAt: new Date(time).toISOString() })
  if (failure === 'http') request.mockResolvedValueOnce(new Response(null, { status: 401 }))
  if (failure === 'network') request.mockRejectedValueOnce(new Error('secret-token'))
  if (failure === 'invalid') request.mockResolvedValueOnce(new Response('invalid json'))
  if (failure === 'empty') request.mockResolvedValueOnce(new Response('{}'))
  if (failure === 'credentials') files.readText.mockImplementationOnce(() => { throw new Error('secret-token') })
  time += 60_000
  const stale = await service.getUsage()
  expect(stale).toEqual({ ...first, stale: true })
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn.mock.calls.flat().join()).not.toContain('secret-token')
  expect(await service.getUsage()).toEqual(stale)
  expect(warn).toHaveBeenCalledTimes(1)
  time += 60_000
  request.mockResolvedValueOnce(valid(0))
  expect(await service.getUsage()).toMatchObject({ fiveHour: { utilization: 0 }, stale: false, updatedAt: new Date(time).toISOString() })
})

test('first failure explicitly reports unavailable without querying with missing credentials', async () => {
  const request = vi.fn<typeof fetch>()
  const warn = vi.fn()
  const service = createClaudeUsageService('credentials', request, { files: { readText: () => '{}' }, warn })
  expect(await service.getUsage()).toEqual({ fiveHour: null, sevenDay: null, fable: null, stale: true, updatedAt: null })
  expect(request).not.toHaveBeenCalled()
  expect(warn).toHaveBeenCalledWith('[claude-usage] Refresh failed: credentials_missing_token')
})

test('concurrent refreshes share one upstream request', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(valid(15))
  const service = createClaudeUsageService('credentials', request, { files: credentials })
  const [a, b] = await Promise.all([service.getUsage(), service.getUsage()])
  expect(a).toEqual(b)
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
})
