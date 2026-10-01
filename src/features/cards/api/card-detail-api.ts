import { ApiError, apiClient } from '@/shared/api/api-client'
import { requestJson } from '@/shared/api/request-json'
import type { EditorDiscovery, MegaBrainSettings } from '../../../../shared/domain/settings'
import type { ChatAgentSettings, ChatEntry, ChatEvent } from '../../../../shared/contracts/chat'
import type { CardAgentUsage, CardAgentUsageEntry } from '../../../../shared/domain/agents'

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
  usage: CardAgentUsage
  usageBreakdown: CardAgentUsageEntry[]
}

export interface SmartDiffFile {
  path: string
  patch: string
  explanation: { before?: string; after?: string; tests?: string }
}

export interface SmartDiffReview {
  schemaVersion: 2
  readingGuide?: string
  sections: { title: string; summary: string; files: SmartDiffFile[] }[]
  noise: { path: string; reason: string; source: string }[]
  warnings?: string[]
}

export interface CardDiffDocument {
  schemaVersion: 1
  generatedAt: string
  repositories: { name: string; review: SmartDiffReview }[]
}

export interface DiffState {
  status: 'running' | 'ready' | 'error'
  result?: CardDiffDocument
  error?: string
  steps?: string[]
  started: boolean
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

export async function saveMegaBrainSettings(settings: MegaBrainSettings): Promise<MegaBrainSettings> {
  const saved = await requestJson<MegaBrainSettings>('/api/workspace/settings', 'Falha ao salvar configurações', {
    method: 'POST',
    body: settings,
  })
  if (saved.general?.jevEnabled !== settings.general.jevEnabled) {
    throw new Error(
      'O backend não confirmou a configuração do Jev. Reinicie o Mega Brain com o backend atualizado e salve novamente.',
    )
  }
  return saved
}

export function fetchDetail(name: string): Promise<CardDetail> {
  return requestJson(`/api/workspace/detail?name=${encodeURIComponent(name)}`, 'Falha ao ler os detalhes da task')
}

export function fetchDiff(name: string): Promise<DiffState> {
  return requestJson<DiffState>(`/api/workspace/diff?name=${encodeURIComponent(name)}`, 'Falha ao ler o diff da task')
}

export async function fetchStandardDiff(name: string): Promise<RepoDiff[]> {
  const data = await requestJson<{ repos: RepoDiff[] }>(
    `/api/workspace/diff/standard?name=${encodeURIComponent(name)}`,
    'Falha ao ler o diff padrão da task',
  )
  return data.repos
}

export function startDiff(name: string, regenerate = false): Promise<DiffState> {
  return requestJson<DiffState>('/api/workspace/diff', 'Falha ao iniciar o diff da task', {
    method: 'POST',
    body: { name, regenerate },
  })
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
