import { expect, test } from 'vitest'
import { parseCodexUsage } from './service'
test('uses the Codex bucket and identifies windows by duration rather than primary/secondary order', () => {
  expect(
    parseCodexUsage({
      rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 83, windowDurationMins: 10080, resetsAt: 1800000000 }, secondary: null },
      },
      rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } },
    }),
  ).toMatchObject({ fiveHour: null, sevenDay: { utilization: 83, resetsAt: new Date(1800000000000).toISOString() } })
  expect(
    parseCodexUsage({
      rateLimits: {
        primary: { usedPercent: 0, windowDurationMins: 300 },
        secondary: { usedPercent: 14, windowDurationMins: 10080 },
      },
    }),
  ).toMatchObject({ fiveHour: { utilization: 0 }, sevenDay: { utilization: 14 } })
})
test('missing and invalid windows are unavailable, not zero', () => {
  expect(parseCodexUsage({ rateLimits: { primary: { usedPercent: NaN, windowDurationMins: 300 } } })).toEqual({
    fiveHour: null,
    sevenDay: null,
    fable: null,
  })
})
