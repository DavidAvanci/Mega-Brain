import type { AgentSessionsResponse } from '../../../../shared/domain/agents'
import { requestJson } from '../../../shared/api/request-json'

export function listAgentSessions(): Promise<AgentSessionsResponse> {
  return requestJson('/api/agents', 'Falha ao listar agentes')
}

export function stopAgentSession(id: string): Promise<{ ok: true }> {
  return requestJson('/api/agents/stop', 'Falha ao interromper o agente', { method: 'POST', body: { id } })
}
