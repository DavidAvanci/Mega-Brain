import { useEffect, useRef } from 'react'
import { useAgentSessions } from './features/agents/model/agents-state'
import type { AgentStatus } from '../shared/domain/agents'
import { playTaskSound } from './task-sounds'
export function useAgentSounds(enabled: boolean) {
  const { sessions, loaded, error } = useAgentSessions()
  const previous = useRef<Map<string, AgentStatus> | null>(null)
  useEffect(() => {
    if (!loaded || error) return
    const standalone = sessions.filter((session) => !session.cardId)
    if (enabled && previous.current)
      for (const session of standalone) {
        const before = previous.current.get(session.id)
        if (before === session.status) continue
        if (session.status === 'rodando' && before !== 'aguardando') playTaskSound('started')
        else if (before && session.status === 'aguardando') playTaskSound('input')
        else if (before && session.status === 'concluido') playTaskSound('finished')
        else if (before && session.status === 'erro') playTaskSound('failed')
      }
    previous.current = new Map(standalone.map((session) => [session.id, session.status]))
  }, [sessions, loaded, error, enabled])
}
