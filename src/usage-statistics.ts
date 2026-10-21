const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatUsageReset(resetsAt: string | null, now: number) {
  const resetAt = resetsAt ? Date.parse(resetsAt) : NaN
  if (!Number.isFinite(resetAt)) {
    return { label: 'Reset não informado', remainingLabel: '—', dateTime: null, dateLabel: null, fullDateLabel: null }
  }

  const date = new Date(resetAt)
  const remaining = resetAt - now
  const days = Math.floor(remaining / DAY)
  const hours = Math.floor((remaining % DAY) / HOUR)
  const minutes = Math.floor((remaining % HOUR) / MINUTE)
  const duration = [days > 0 && `${days}d`, hours > 0 && `${hours}h`, minutes > 0 && `${minutes}min`]
    .filter(Boolean)
    .join(' ')

  const remainingLabel = remaining <= 0 ? 'Aguardando atualização' : duration || '< 1min'
  return {
    label: remaining <= 0 ? 'Aguardando atualização' : `Reseta em ${remainingLabel}`,
    remainingLabel,
    dateTime: date.toISOString(),
    dateLabel: date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    }) + ' - ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    fullDateLabel: `Reset: ${date.toLocaleString('pt-BR', { timeZoneName: 'short' })}`,
  }
}
