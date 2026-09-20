import { requestJson } from '../../../shared/api/request-json'
import type { FlowLevel } from '../../../../shared/domain/cards'
import type { WorkspaceFolder } from '../model/card-mappers'

export function listWorkspace(): Promise<WorkspaceFolder[]> {
  return requestJson('/api/workspace', 'Falha ao listar o workspace')
}

export function createWorkspaceCard(
  title: string,
  description: string,
  flow: FlowLevel,
  name?: string,
): Promise<unknown> {
  return requestJson('/api/workspace', 'Falha ao criar pasta da task', {
    method: 'POST',
    body: { title, description, flow, ...(name ? { name } : {}) },
  })
}

export function updateWorkspaceCard(
  name: string,
  patch: Record<string, unknown>,
  fallback = 'Falha ao atualizar o card',
): Promise<unknown> {
  return requestJson('/api/workspace/update', fallback, { method: 'POST', body: { name, ...patch } })
}

export function deleteWorkspaceCard(name: string): Promise<unknown> {
  return requestJson('/api/workspace/delete', 'Falha ao excluir a pasta', { method: 'POST', body: { name } })
}

export function workspaceAction(path: string, fallback: string, body: Record<string, unknown>): Promise<unknown> {
  return requestJson(path, fallback, { method: 'POST', body })
}
