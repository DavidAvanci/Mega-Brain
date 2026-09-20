import type { Card } from '../../../../shared/domain/cards'

export interface CardsState {
  cards: Card[]
  error: string | null
  loaded: boolean
}

let state: CardsState = { cards: [], error: null, loaded: false }
const listeners = new Set<() => void>()

export function cardsState(): CardsState {
  return state
}

export function setCardsState(next: Partial<CardsState>): void {
  state = { ...state, ...next }
  listeners.forEach((notify) => notify())
}

export function subscribeCards(notify: () => void): () => void {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

export function cardsSubscriberCount(): number {
  return listeners.size
}
