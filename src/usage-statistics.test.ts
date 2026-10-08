import { expect, test } from 'vitest'
import { formatUsageReset } from './usage-statistics'

const NOW = Date.parse('2026-10-08T15:00:00Z')

test.each([
  ['2026-10-15T15:00:00Z', 'Reseta em 7d'],
  ['2026-10-11T19:20:00Z', 'Reseta em 3d 4h 20min'],
  ['2026-10-08T17:18:00Z', 'Reseta em 2h 18min'],
  ['2026-10-08T16:00:00Z', 'Reseta em 1h'],
  ['2026-10-08T15:18:00Z', 'Reseta em 18min'],
  ['2026-10-08T15:00:59Z', 'Reseta em < 1min'],
  ['2026-10-08T15:00:00.001Z', 'Reseta em < 1min'],
])('formats the remaining duration for %s', (resetsAt, label) => {
  expect(formatUsageReset(resetsAt, NOW)).toMatchObject({ label, dateTime: new Date(resetsAt).toISOString() })
})

test.each(['2026-10-08T15:00:00Z', '2026-10-07T12:00:00Z'])(
  'waits for new provider data once the reset time has passed (%s)',
  (resetsAt) => {
    expect(formatUsageReset(resetsAt, NOW).label).toBe('Aguardando atualização')
  },
)

test.each([null, '', 'invalid-date'])('reports an unknown reset without an invalid date (%s)', (resetsAt) => {
  expect(formatUsageReset(resetsAt, NOW)).toEqual({
    label: 'Reset não informado',
    dateTime: null,
    dateLabel: null,
    fullDateLabel: null,
  })
})

test('preserves timezone offsets from the provider and labels the reset in the local timezone', () => {
  const reset = formatUsageReset('2026-10-08T14:18:00-03:00', NOW)
  expect(reset.label).toBe('Reseta em 2h 18min')
  expect(reset.dateTime).toBe('2026-10-08T17:18:00.000Z')
  expect(reset.dateLabel).toMatch(/08\/10/)
  expect(reset.fullDateLabel).toContain('2026')
})
