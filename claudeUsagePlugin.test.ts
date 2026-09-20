import { expect, test } from 'vitest'
import { parseUsage } from './server/claude-usage/service'

test('parseUsage', () => {
  const empty = { fiveHour: null, sevenDay: null, fable: null }
  expect(parseUsage(null)).toEqual(empty)
  expect(parseUsage('erro')).toEqual(empty)
  expect(parseUsage({})).toEqual(empty)
  expect(parseUsage({ five_hour: { utilization: 'x' }, seven_day: { resets_at: 'y' } })).toEqual(empty)

  expect(
    parseUsage({
      five_hour: { utilization: 49.0, resets_at: '2026-08-21T21:50:00+00:00', limit_dollars: null },
      seven_day: { utilization: 16.0, resets_at: null },
      limits: [
        { kind: 'weekly_all', percent: 16, resets_at: null, scope: null },
        {
          kind: 'weekly_scoped',
          percent: 88,
          resets_at: '2026-08-28T01:00:00+00:00',
          scope: { model: { id: null, display_name: 'Fable' } },
        },
      ],
    }),
  ).toEqual({
    fiveHour: { utilization: 49, resetsAt: '2026-08-21T21:50:00+00:00' },
    sevenDay: { utilization: 16, resetsAt: null },
    fable: { utilization: 88, resetsAt: '2026-08-28T01:00:00+00:00' },
  })
})
