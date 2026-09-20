import { ApiError, apiClient } from '@/shared/api/api-client'
import { requestJson } from '@/shared/api/request-json'
import type { EditorDiscovery, MegaBrainSettings } from '../../../../shared/domain/settings'
import type { ChatAgentSettings, ChatEntry, ChatEvent } from '../../../../shared/contracts/chat'

export interface WorktreeRepoInfo {
  name: string
  path: string
  repository: string
  remote?: string
  branch: string
  head: { hash: string; shortHash: string; subject: string; committedAt: string }
  base?: { ref: string; hash: string; shortHash: string; inferred: boolean; createdAt?: string }
  dirty: boolean
  error?: string
}

export interface CardDetail {
  files: Record<string, string | null>
  repos: WorktreeRepoInfo[]
}

export interface RepoDiff {
  name: string
  diff: string
  error?: string
}

export interface ChatHistory {
  sessionId: string | null
  entries: ChatEntry[]
  settings?: ChatAgentSettings | null
}

export { requestJson } from '@/shared/api/request-json'

export function fetchMegaBrainSettings(): Promise<MegaBrainSettings> {
  return requestJson('/api/workspace/settings', 'Falha ao carregar configurações')
}

export function fetchDetectedEditors(): Promise<EditorDiscovery> {
  return requestJson('/api/workspace/settings/editors', 'Falha ao detectar os editores instalados')
}

export function saveMegaBrainSettings(settings: MegaBrainSettings): Promise<MegaBrainSettings> {
  return requestJson('/api/workspace/settings', 'Falha ao salvar configurações', { method: 'POST', body: settings })
}

export function fetchDetail(name: string): Promise<CardDetail> {
  return requestJson(`/api/workspace/detail?name=${encodeURIComponent(name)}`, 'Falha ao ler os detalhes da task')
}

export async function fetchDiff(name: string): Promise<RepoDiff[]> {
  const data = await requestJson<{ repos: RepoDiff[] }>(
    `/api/workspace/diff?name=${encodeURIComponent(name)}`,
    'Falha ao gerar o diff da task',
  )
  return data.repos
}

export function fetchChat(name: string): Promise<ChatHistory> {
  return requestJson(`/api/chat?name=${encodeURIComponent(name)}`, 'Falha ao ler o chat da task')
}

export async function abortChat(name: string): Promise<void> {
  await apiClient().request('/api/chat/abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function sendChat(name: string, text: string, onEvent: (event: ChatEvent) => void): Promise<void> {
  try {
    await apiClient().sse('/api/chat/send', {
      method: 'POST',
      body: JSON.stringify({ name, text }),
      headers: { 'Content-Type': 'application/json' },
      onEvent: (event) => onEvent(event as ChatEvent),
    })
  } catch (error) {
    if (error instanceof ApiError && error.message === `Request failed (HTTP ${error.status})`) {
      throw new Error(`Falha ao enviar a mensagem (HTTP ${error.status})`)
    }
    throw error
  }
}
