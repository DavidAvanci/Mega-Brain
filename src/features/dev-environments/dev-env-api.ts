import type { DevEnvLogs, DevEnvPreview, DevEnvStartOptions } from '../../../shared/domain/dev-environments'
import type { DevEnvInfo } from '../../../shared/domain/agents'
import type { ChatEvent, ChatModelSelection } from '../../../shared/contracts/chat'
import type { ChatHistory } from '@/features/cards/api/card-detail-api'
import { apiClient } from '@/shared/api/api-client'
import { requestJson } from '@/shared/api/request-json'
import { refresh } from '@/features/cards/model/card-commands'

export const previewDevEnv = (name: string): Promise<DevEnvPreview> =>
  requestJson('/api/workspace/dev-env/preview', 'Falha ao preparar a prévia do ambiente dev', {
    method: 'POST',
    body: { name },
  })

export const fetchDevEnv = (name: string): Promise<DevEnvInfo | null> =>
  requestJson(`/api/workspace/dev-env?name=${encodeURIComponent(name)}`, 'Falha ao consultar o ambiente')
export const fetchDevEnvLogs = (name: string, file?: string): Promise<DevEnvLogs> =>
  requestJson('/api/workspace/dev-env/logs', 'Falha ao ler os logs', { method: 'POST', body: { name, file } })
export const fetchDevEnvAgent = (name: string): Promise<ChatHistory> =>
  requestJson(`/api/dev-env-agent?name=${encodeURIComponent(name)}`, 'Falha ao carregar o terminal do agente')
export const abortDevEnvAgent = (name: string): Promise<unknown> =>
  requestJson('/api/dev-env-agent/abort', 'Falha ao interromper o agente', { method: 'POST', body: { name } })
export const sendDevEnvAgent = (
  name: string,
  text: string,
  onEvent: (event: ChatEvent) => void,
  configuration?: DevEnvStartOptions,
  selection?: ChatModelSelection,
) =>
  apiClient().sse('/api/dev-env-agent/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text, configuration, selection }),
    onEvent: (event) => onEvent(event as ChatEvent),
  })

export async function startConfiguredDevEnv(name: string, configuration: DevEnvStartOptions): Promise<void> {
  await requestJson('/api/workspace/dev-env', 'Falha ao iniciar o ambiente dev', {
    method: 'POST',
    body: { name, configuration },
  })
  await refresh()
}
