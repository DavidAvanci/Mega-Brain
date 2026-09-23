import { useSyncExternalStore } from 'react'
import type { AgentSession, AgentStatus } from '../../../../shared/domain/agents'
import { listAgentSessions, stopAgentSession as requestAgentStop } from '../api/agents-api'

const POLL_INTERVAL_MS = 5_000
const ACTIVE_STATUSES: ReadonlySet<AgentStatus> = new Set(['rodando', 'aguardando'])

export interface AgentsState {
  sessions: AgentSession[]
  loaded: boolean
  refreshing: boolean
  error: string | null
}

let state: AgentsState = { sessions: [], loaded: false, refreshing: false, error: null }
let pending: Promise<void> | null = null
let timer: number | undefined
const listeners = new Set<() => void>()

function update(patch: Partial<AgentsState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function isAgentSessionActive(session: AgentSession): boolean {
  return ACTIVE_STATUSES.has(session.status)
}

export function refreshAgentSessions(manual = false): Promise<void> {
  if (pending) return pending
  if (manual) update({ refreshing: true })
  pending = listAgentSessions()
    .then((response) => update({ sessions: response.sessions, loaded: true, error: null }))
    .catch((cause) =>
      update({
        loaded: true,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    )
    .finally(() => {
      pending = null
      if (manual) update({ refreshing: false })
    })
  return pending
}

export async function stopAgentSession(id: string): Promise<void> {
  try {
    await requestAgentStop(id)
    update({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, status: 'morto', pid: undefined, updatedAt: new Date().toISOString() } : session,
      ),
      error: null,
    })
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)
    update({ error })
    throw cause
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshAgentSessions()
    timer = window.setInterval(refreshAgentSessions, POLL_INTERVAL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.clearInterval(timer)
  }
}

function snapshot(): AgentsState {
  return state
}

export function useAgentSessions(): AgentsState {
  return useSyncExternalStore(subscribe, snapshot)
}
