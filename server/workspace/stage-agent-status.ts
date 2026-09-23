import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { AgentInfo } from '../../shared/domain/agents'
import { parseJsonRecord, readTail, record, summarizeAgentInput, toolUse } from '../agent-log'
import { readFlow } from './card-folder'
import { readCard } from './card-record'
import { AGENT_FILE, settingsForStage } from './stage-agent'
import { STAGES, type Stage } from './stage-catalog'

const STREAM_TAIL_BYTES = 128 * 1024

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const RESULT_SUBTYPE_ERRORS: Record<string, string> = {
  error_max_turns: 'Limite de turnos atingido',
  error_during_execution: 'Erro durante a execução',
}

export function stageEndedDueToRateLimit(path: string, stage: Stage): boolean {
  const stream = join(path, `${stage.name}.jsonl`)
  if (!existsSync(stream)) return false
  return readTail(stream, STREAM_TAIL_BYTES)
    .split('\n')
    .some((line) => {
      try {
        const event = parseJsonRecord(line)
        return event?.error === 'rate_limit' || event?.type === 'rate_limit_event'
      } catch {
        return false
      }
    })
}

export function canRetryStageWithOpus(path: string, stage: Stage): boolean {
  if (stage.script || !settingsForStage(path, stage).model.toLowerCase().includes('fable')) return false
  try {
    const meta = JSON.parse(readFileSync(join(path, AGENT_FILE), 'utf8')) as { model?: unknown }
    return typeof meta.model !== 'string' || !meta.model.toLowerCase().includes('opus')
  } catch {
    return true
  }
}

export function readAgent(path: string, alive: (pid: number) => boolean = pidAlive): AgentInfo | null {
  const metaFile = join(path, AGENT_FILE)
  if (!existsSync(metaFile)) return null
  let meta: { pid?: number; startedAt?: string; stage?: string } = {}
  try {
    meta = JSON.parse(readFileSync(metaFile, 'utf8'))
  } catch {}
  const stage = STAGES.find((candidate) => candidate.name === meta.stage) ?? STAGES[0]
  const info: AgentInfo = { stage: stage.name, status: 'rodando', startedAt: meta.startedAt }
  let finished = false
  const stream = join(path, `${stage.name}.jsonl`)
  if (existsSync(stream)) {
    for (const line of readTail(stream, STREAM_TAIL_BYTES).split('\n')) {
      const event = parseJsonRecord(line)
      if (!event) continue
      if (typeof event?.session_id === 'string') info.sessionId = event.session_id
      if (event?.type === 'thread.started' && typeof event.thread_id === 'string') info.sessionId = event.thread_id
      if (event?.type === 'result') {
        finished = true
        if (event.subtype === 'success' && !event.is_error) info.status = 'concluido'
        else {
          info.status = 'erro'
          const subtype = typeof event.subtype === 'string' ? event.subtype : undefined
          const detail =
            typeof event.result === 'string' && event.result.trim()
              ? event.result
              : subtype
                ? (RESULT_SUBTYPE_ERRORS[subtype] ?? subtype)
                : undefined
          if (detail) info.error = String(detail).trim().replace(/\s+/g, ' ').slice(0, 300)
        }
      }
      if (event?.type === 'turn.completed') {
        finished = true
        info.status = 'concluido'
      }
      if (event?.type === 'turn.failed' || event?.type === 'error') {
        finished = true
        info.status = 'erro'
        const detail = record(event.error)?.message ?? event.message ?? 'O ChatGPT não concluiu a execução'
        info.error = String(detail).trim().replace(/\s+/g, ' ').slice(0, 300)
      }
      if (event?.type === 'assistant') {
        const tool = toolUse(event)
        if (tool) info.activity = [tool.name, summarizeAgentInput(record(tool.input))].filter(Boolean).join(': ')
      }
      const item = record(event.item)
      if ((event?.type === 'item.started' || event?.type === 'item.completed') && item) {
        info.activity = String(item.command ?? item.text ?? item.type ?? '').slice(0, 300)
      }
    }
  }
  if (!finished) info.status = typeof meta.pid === 'number' && alive(meta.pid) ? 'rodando' : 'morto'
  if (info.status === 'rodando') {
    const flow = readFlow(readCard(path, basename(path)).flow)
    const { done, total, phase } = stage.progress(path, meta.startedAt, flow)
    const started = Boolean(info.sessionId) || Boolean(stage.script)
    info.phase = started ? phase : 'Iniciando agente'
    info.progress = { done: started ? done : 0, total }
  }
  return info
}
