import { closeSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentProvider } from '../../shared/domain/agents'
import { parseJsonRecord } from '../agent-log'

export type StageCheckpoint = {
  args: string[]
  environment: Record<string, string>
}

export type StageAgentRecord = {
  pid?: number | null
  stage?: string
  provider?: AgentProvider
  startedAt?: string
  pausedAt?: string
  sessionId?: string
  resume?: StageCheckpoint
  [key: string]: unknown
}

/** The session announcement may have scrolled out of the status reader's tail. */
export function stageSessionId(stream: string): string | undefined {
  try {
    const file = openSync(stream, 'r')
    const buffer = Buffer.alloc(64 * 1024)
    let length: number
    try {
      length = readSync(file, buffer, 0, buffer.length, 0)
    } finally {
      closeSync(file)
    }
    for (const line of buffer.toString('utf8', 0, length).split('\n')) {
      const event = parseJsonRecord(line)
      if (typeof event?.session_id === 'string') return event.session_id
      if (event?.type === 'thread.started' && typeof event.thread_id === 'string') return event.thread_id
    }
  } catch {
    /* A provider may not have created its stream yet. */
  }
  return undefined
}

export function readStageAgentRecord(path: string): StageAgentRecord | undefined {
  try {
    const value: StageAgentRecord = JSON.parse(readFileSync(join(path, 'agent.json'), 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    return value
  } catch {
    return undefined
  }
}

export function writeStageAgentRecord(path: string, value: StageAgentRecord): void {
  const target = join(path, 'agent.json')
  writeFileSync(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(`${target}.tmp`, target)
}

export function validCheckpoint(value: StageCheckpoint | undefined): value is StageCheckpoint {
  return Boolean(
    value &&
    Array.isArray(value.args) &&
    value.args.every((arg) => typeof arg === 'string') &&
    value.environment &&
    typeof value.environment === 'object' &&
    Object.values(value.environment).every((entry) => typeof entry === 'string'),
  )
}

export function continuationPrompt(prompt: string): string {
  return [
    'A execução foi pausada pelo usuário. Continue de onde parou.',
    'Confira o estado atual dos arquivos e preserve o trabalho já realizado. Não repita itens concluídos.',
    'Se alguma operação ou pergunta ficou pendente, confira seu resultado ou pergunte novamente antes de continuar.',
    '',
    'Pedido original:',
    prompt,
  ].join('\n')
}

/** Use the exact session, never the provider\'s most recent session. */
export function continuationArgs(
  provider: AgentProvider,
  args: readonly string[],
  sessionId?: string,
  pendingContext = '',
): string[] {
  const next = [...args]
  if (provider === 'codex') {
    const prompt = next.pop() ?? ''
    if (sessionId) next.splice(1, 0, 'resume')
    return [...next, ...(sessionId ? [sessionId] : []), continuationPrompt(`${prompt}${pendingContext}`)]
  }
  const promptIndex = next.indexOf('-p') + 1
  if (promptIndex > 0) next[promptIndex] = continuationPrompt(`${next[promptIndex] ?? ''}${pendingContext}`)
  if (sessionId) next.push('--resume', sessionId)
  return next
}
