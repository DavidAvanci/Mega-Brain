import { expect, test } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeKeychainService } from './credentials'
import { createClaudeUsageService, parseUsage } from './service'
test('uses default or directory-specific macOS credential identities', () => {
  expect(claudeKeychainService(join(homedir(), '.claude', '.credentials.json'))).toBe('Claude Code-credentials')
  expect(claudeKeychainService('/tmp/claude-work/.credentials.json')).toMatch(/^Claude Code-credentials-[a-f0-9]{8}$/)
})
test('reads macOS credential provider without writing tokens to disk', async () => {
  let calls = 0
  const service = createClaudeUsageService(
    'unused',
    async () => new Response(JSON.stringify({ five_hour: { utilization: 25 } })),
    {
      credentials: async () => {
        calls++
        return JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-only' } })
      },
    },
  )
  expect(await service.getUsage()).toMatchObject({ fiveHour: { utilization: 25 }, stale: false })
  expect(calls).toBe(1)
})
test('supports model windows returned by the current usage endpoint', () => {
  expect(parseUsage({ five_hour: { utilization: Infinity }, seven_day_sonnet: { utilization: 12 } })).toMatchObject({
    fiveHour: null,
    fable: { utilization: 12 },
  })
})
