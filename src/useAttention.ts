import { useEffect, useRef } from 'react'
import { consumeUserInitiatedStatusChange } from './features/cards/model/card-commands'
import type { AgentStatus } from '../shared/domain/agents'
import type { Card, Status } from '../shared/domain/cards'

export const ATTENTION_STATUSES: ReadonlySet<Status> = new Set(['revisao-de-plano', 'code-review'])

type AttentionEvent = 'review' | 'error' | 'input'

interface CardSignals {
  status: Status
  hasError: boolean
  autonomousWaiting: boolean
  autonomousStatus: AgentStatus | null
}

let notificationPermission: Promise<NotificationPermission> | null = null

function playSound(event: AttentionEvent): void {
  try {
    const ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(event === 'error' ? 0.26 : 0.2, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.75)
    const notes = event === 'review' ? [660, 880] : event === 'error' ? [440, 330, 220] : [523, 659, 784]
    notes.forEach((frequency, index) => {
      const osc = ctx.createOscillator()
      osc.type = event === 'error' ? 'triangle' : 'sine'
      osc.frequency.value = frequency
      osc.connect(gain)
      osc.start(ctx.currentTime + index * 0.12)
      osc.stop(ctx.currentTime + index * 0.12 + 0.45)
    })
    window.setTimeout(() => void ctx.close(), 1000)
  } catch {}
}

function sendNotification(title: string, body: string): void {
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  if (!('Notification' in window)) return
  const notify = () => {
    const notification = new Notification(title, { body })
    notification.onclick = () => window.focus()
  }
  if (Notification.permission === 'granted') return notify()
  if (Notification.permission !== 'default') return
  notificationPermission ??= Notification.requestPermission()
  void notificationPermission.then((permission) => permission === 'granted' && notify()).catch(() => {})
}

function signalsFor(card: Card): CardSignals {
  const autonomousAgent = card.agents?.find((agent) => !agent.stage)
  return {
    status: card.status,
    hasError: card.agents?.some((agent) => agent.status === 'erro') === true || card.devEnv?.status === 'erro',
    autonomousWaiting: autonomousAgent?.status === 'aguardando',
    autonomousStatus: autonomousAgent?.status ?? null,
  }
}

// Uma sessão pode ser descoberta pelo polling já parada no prompt inicial. Só é
// atenção nova se o board a viu trabalhando antes de ela pedir uma resposta.
export function shouldNotifyInput(before: CardSignals, current: CardSignals): boolean {
  return before.autonomousStatus === 'rodando' && current.autonomousWaiting
}

function notify(event: AttentionEvent, card: Card): void {
  playSound(event)
  if (event === 'review') {
    sendNotification('Card pronto para revisão', `${card.id}: ${card.title}`)
  } else if (event === 'error') {
    const agentError = card.agents?.find((agent) => agent.status === 'erro')?.error
    sendNotification('Erro em um card', `${card.id}: ${agentError ?? card.devEnv?.error ?? card.title}`)
  } else {
    sendNotification('Agente aguardando seu input', `${card.id}: ${card.title}`)
  }
}

export function useAttention(cards: Card[], loaded: boolean): void {
  const count = cards.filter((card) => ATTENTION_STATUSES.has(card.status)).length

  useEffect(() => {
    document.title = count > 0 ? `(${count}) Mega Brain` : 'Mega Brain'
  }, [count])

  const previous = useRef<Map<string, CardSignals> | null>(null)
  useEffect(() => {
    if (!loaded) return
    const signals = new Map(cards.map((card) => [card.id, signalsFor(card)]))
    if (previous.current) {
      for (const card of cards) {
        const before = previous.current.get(card.id)
        const current = signals.get(card.id)
        if (!before || !current) continue
        if (
          ATTENTION_STATUSES.has(current.status) &&
          before.status !== current.status &&
          !consumeUserInitiatedStatusChange(card.id, current.status)
        )
          notify('review', card)
        if (current.hasError && !before.hasError) notify('error', card)
        if (shouldNotifyInput(before, current)) notify('input', card)
      }
    }
    previous.current = signals
  }, [cards, loaded])
}
