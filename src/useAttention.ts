import { playTaskSound } from './task-sounds'
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
  running?: boolean
  autonomousStatus: AgentStatus | null
}

let notificationPermission: Promise<NotificationPermission> | null = null

function playSound(event: AttentionEvent): void {
  playTaskSound(event === 'error' ? 'failed' : event === 'input' ? 'input' : 'finished')
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
    running: card.agents?.some((agent) => agent.status === 'rodando') === true,
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

function notify(event: AttentionEvent, card: Card, taskSounds: boolean): void {
  if (taskSounds) playSound(event)
  if (event === 'review') {
    sendNotification('Card pronto para revisão', `${card.id}: ${card.title}`)
  } else if (event === 'error') {
    const agentError = card.agents?.find((agent) => agent.status === 'erro')?.error
    sendNotification('Erro em um card', `${card.id}: ${agentError ?? card.devEnv?.error ?? card.title}`)
  } else {
    sendNotification('Agente aguardando seu input', `${card.id}: ${card.title}`)
  }
}

export function useAttention(cards: Card[], loaded: boolean, taskSounds = true): void {
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
          notify('review', card, taskSounds)
        if (taskSounds && !before.hasError && !current.hasError && current.running === true && before.running !== true)
          playTaskSound('started')
        if (current.hasError && !before.hasError) notify('error', card, taskSounds)
        if (shouldNotifyInput(before, current)) notify('input', card, taskSounds)
      }
    }
    previous.current = signals
  }, [cards, loaded, taskSounds])
}
