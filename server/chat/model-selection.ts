import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatModelSelection } from '../../shared/contracts/chat'
import type { LlmProvider } from '../../shared/domain/settings'

const filename = 'chat-model.json'

export function parseChatModelSelection(value: unknown): ChatModelSelection | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || !('provider' in value) || !('model' in value))
    throw new Error('Seleção de modelo inválida')
  if (value.provider !== 'claude' && value.provider !== 'chatgpt') throw new Error('Provedor de chat inválido')
  if (typeof value.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(value.model))
    throw new Error('Modelo de chat inválido')
  return { provider: value.provider, model: value.model }
}

export function readChatModelSelection(path: string, provider: LlmProvider = 'claude'): ChatModelSelection {
  try {
    return (
      parseChatModelSelection(JSON.parse(readFileSync(join(path, filename), 'utf8'))) ?? { provider, model: 'default' }
    )
  } catch {
    return { provider, model: 'default' }
  }
}

export function saveChatModelSelection(path: string, selection: ChatModelSelection): void {
  const file = join(path, filename)
  writeFileSync(`${file}.tmp`, JSON.stringify(selection), { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}
