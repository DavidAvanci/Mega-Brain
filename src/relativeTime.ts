const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

const fmt = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'narrow' })

export function relativeTime(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return fmt.format(-Math.round(seconds / size), unit)
  }
  return 'now'
}
