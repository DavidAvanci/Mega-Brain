const WINDOWS: Partial<Record<number, [start: number, end: number][]>> = {
  1: [
    [9 * 60, 11 * 60],
    [14 * 60, 16 * 60],
  ],
  2: [
    [9 * 60, 11 * 60],
    [14 * 60, 16 * 60],
  ],
  3: [[9 * 60, 11 * 60]],
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function saoPauloTime(date: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    day: WEEKDAYS.indexOf(get('weekday')),
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  }
}

/** Returns the next deploy window in São Paulo time for automation clients. */
export function nextDeploySlot(now: Date = new Date()): { open: boolean; label: string } {
  const { day, minutes } = saoPauloTime(now)
  const open = (WINDOWS[day] ?? []).some(([start, end]) => minutes >= start && minutes < end)
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(now.getTime() + offset * 86_400_000)
    const target = offset === 0 ? { day, minutes } : saoPauloTime(date)
    const start = (WINDOWS[target.day] ?? []).find(([value]) => offset > 0 || value >= minutes)?.[0]
    if (start !== undefined) {
      const time = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`
      const dayLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(date)
      return { open, label: `${WEEKDAY_FULL[target.day]} ${dayLabel} ${time}` }
    }
  }
  return { open, label: '' }
}
