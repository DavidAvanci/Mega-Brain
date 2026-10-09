import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatEntry } from '../../shared/contracts/chat'
import { parseJsonRecord, readTail, record } from '../agent-log'

interface ConversationRecord {
  id: string
  entry?: ChatEntry
  queued?: boolean
  delivered?: string[]
  context?: string
}

const filename = 'task-conversation.jsonl'

function records(path: string): ConversationRecord[] {
  const file = join(path, filename)
  if (!existsSync(file)) return []
  return readTail(file, 2 * 1024 * 1024).split('\n').flatMap(line => {
    const parsed = parseJsonRecord(line)
    return parsed && typeof parsed.id === 'string' ? [parsed as unknown as ConversationRecord] : []
  })
}

function append(path: string, value: ConversationRecord): void {
  appendFileSync(join(path, filename), `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

export function appendConversation(path: string, entry: ChatEntry, queued = false, context?: string): void {
  append(path, { id: randomUUID(), entry, queued, context })
}

export function pendingTaskMessages(path: string): ConversationRecord[] {
  const all = records(path)
  const delivered = new Set(all.flatMap(row => row.delivered ?? []))
  return all.filter(row => row.queued && row.entry?.role === 'user' && !delivered.has(row.id))
}

export function taskConversation(path: string): ChatEntry[] {
  const pending = new Set(pendingTaskMessages(path).map(row => row.id))
  return records(path).flatMap(row => row.entry ? [{ ...row.entry, queued: pending.has(row.id) }] : []).slice(-500)
}

export function taskMessageContext(path: string): { prompt: string; acknowledge: () => void } {
  const pending = pendingTaskMessages(path)
  const messages = records(path).filter(row => row.queued && row.entry?.role === 'user').slice(-50)
  return {
    prompt: messages.length ? `\n\nMensagens adicionais do usuário sobre esta tarefa (aplique as orientações pertinentes ao item atual):\n${messages.map(row => row.context ?? row.entry?.text).join('\n\n')}` : '',
    acknowledge: () => {
      if (pending.length) append(path, { id: randomUUID(), delivered: pending.map(row => row.id) })
    },
  }
}

/** Only messages and tool labels are retained, never provider reasoning or raw stderr. */
export function executionEntries(line: string): ChatEntry[] {
  const event = parseJsonRecord(line)
  if (!event) return []
  const item = record(event.item)
  if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string')
    return [{ role: 'assistant', text: item.text }]
  if (event.type === 'item.started' && item?.type === 'command_execution')
    return [{ role: 'assistant', tool: String(item.command ?? 'Executando comando') }]
  const content = record(event.message)?.content
  if (event.type === 'assistant' && Array.isArray(content)) return content.flatMap<ChatEntry>(block => {
    const value = record(block)
    if (value?.type === 'text' && typeof value.text === 'string') return [{ role: 'assistant' as const, text: value.text }]
    if (value?.type === 'tool_use') return [{ role: 'assistant' as const, tool: String(value.name ?? 'Ferramenta') }]
    return []
  })
  if (event.type === 'result' && typeof event.result === 'string' && event.result.trim())
    return [{ role: 'assistant', text: event.result }]
  return []
}
