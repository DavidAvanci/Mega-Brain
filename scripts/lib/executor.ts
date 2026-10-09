import { itemCheckpoint } from './agent-checkpoint.ts'
import { continuationArgs } from '../../server/workspace/agent-checkpoint.ts'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { finishAgentUsage, startAgentUsage } from '../../server/workspace/agent-usage.ts'
import { appendConversation, executionEntries, pendingTaskMessages, taskMessageContext } from '../../server/chat/task-conversation.ts'

export interface ItemResult {
  status: 'done' | 'failed' | 'blocked'
  note: string
  costUsd?: number
  durationMs?: number
  rateLimited?: boolean
}

const RESULT_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['status', 'note'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['done', 'failed', 'blocked'] },
    note: { type: 'string' },
  },
})

export function claudeBin(): string {
  if (process.env.MEGA_BRAIN_CLAUDE_BIN?.trim()) return process.env.MEGA_BRAIN_CLAUDE_BIN.trim()
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const bin = join(dir, 'claude')
    if (dir && existsSync(bin)) return bin
  }
  return 'claude'
}

function codexBin(): string {
  if (process.env.MEGA_BRAIN_CODEX_BIN?.trim()) return process.env.MEGA_BRAIN_CODEX_BIN.trim()
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const bin = join(dir, 'codex')
    if (dir && existsSync(bin)) return bin
  }
  return 'codex'
}

export interface ClaudeItemOptions {
  cwd: string
  prompt: string
  model: string
  effort?: string
  tools: string
  timeoutMs: number
  env?: Record<string, string>
}

type ResultStatus = ItemResult['status']

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function resultFrom(value: unknown, costUsd?: number): ItemResult | null {
  const parsed = record(value)
  const status = parsed?.status
  if (status !== 'done' && status !== 'failed' && status !== 'blocked') return null
  return { status: status as ResultStatus, note: String(parsed?.note ?? ''), costUsd }
}

function parseResult(stdout: string): ItemResult | null {
  let data: Record<string, unknown> | undefined
  try {
    data = record(JSON.parse(stdout))
  } catch {
    for (const line of stdout.split('\n')) {
      try { const event = record(JSON.parse(line)); if (event?.type === 'result') data = event } catch {}
    }
  }
  if (!data) return null
  const costUsd = typeof data.total_cost_usd === 'number' ? data.total_cost_usd : undefined
  const candidates = [data.structured_output, data.structuredOutput]
  if (typeof data.result === 'string') {
    try {
      candidates.push(JSON.parse(data.result))
    } catch {}
  }
  for (const candidate of candidates) {
    const result = resultFrom(candidate, costUsd)
    if (result) return result
  }
  if (data.is_error || data.subtype !== 'success') {
    const detail = String(
      typeof data.result === 'string' && data.result.trim()
        ? data.result.trim().replace(/\s+/g, ' ').slice(0, 300)
        : (data.subtype ?? 'desconhecido'),
    )
    return {
      status: 'failed',
      note: /max[_ -]?turns|turn limit|limite de rodadas/i.test(detail)
        ? `Limite de rodadas atingido: ${detail}`
        : `Agente terminou com erro: ${detail}`,
      costUsd,
      rateLimited: data.error === 'rate_limit' || data.api_error_status === 429,
    }
  }
  return null
}

function parseStructuredText(text: string): ItemResult | null {
  const normalized = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    const value = JSON.parse(normalized)
    const result = resultFrom(value)
    if (result) return result
  } catch {}
  const match = normalized.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return resultFrom(JSON.parse(match[0]))
  } catch {
    return null
  }
}

function parseCodexResult(stdout: string): ItemResult | null {
  let message = ''
  for (const line of stdout.split('\n')) {
    try {
      const event = record(JSON.parse(line))
      if (!event) continue
      const error = record(event.error)
      const item = record(event.item)
      if (event?.type === 'turn.failed' || event?.type === 'error') {
        return { status: 'failed', note: String(error?.message ?? event.message ?? 'Execução do ChatGPT falhou') }
      }
      if (event?.type === 'item.completed' && item?.type === 'agent_message') {
        message = String(item.text ?? '')
      }
    } catch {}
  }
  return parseStructuredText(message)
}

export async function runClaudeItem(options: ClaudeItemOptions): Promise<ItemResult> {
  let result = await runItemPass(options)
  const cardPath = process.env.MEGA_BRAIN_CARD_PATH?.trim()
  while (cardPath && result.status === 'done' && pendingTaskMessages(cardPath).length) {
    const followup = await runItemPass({ ...options, prompt: `${options.prompt}\n\nResposta anterior do agente: ${result.note}\nRevise a implementação deste item considerando as novas mensagens do usuário antes de finalizar.` })
    result = { ...followup, durationMs: (result.durationMs ?? 0) + (followup.durationMs ?? 0), costUsd: result.costUsd === undefined && followup.costUsd === undefined ? undefined : (result.costUsd ?? 0) + (followup.costUsd ?? 0) }
  }
  return result
}

function runItemPass(options: ClaudeItemOptions): Promise<ItemResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const settle = (result: ItemResult) => resolve({ ...result, durationMs: Date.now() - startedAt })
    const provider = process.env.MEGA_BRAIN_LLM_PROVIDER === 'chatgpt' ? 'chatgpt' : 'claude'
    const cardId = process.env.MEGA_BRAIN_CARD_ID?.trim()
    const itemId = options.prompt.match(/(?:^|\n)(?:Item:|Cenário:|Correção orientada por teste que falhou:)\s*([^\s—]+)/)?.[1]
    const stageScript = process.env.MEGA_BRAIN_STAGE_SCRIPT ?? ''
    const stageLabel = stageScript.includes('test-stage')
      ? 'Testes'
      : stageScript.includes('dev-stage')
        ? 'Desenvolvimento'
        : 'Execução'
    const usageModel =
      provider === 'chatgpt' && ['fable', 'opus', 'sonnet', 'haiku', 'default'].includes(options.model.toLowerCase())
        ? undefined
        : options.model
    const sessionName = [cardId, itemId ?? process.env.MEGA_BRAIN_STAGE_SCRIPT].filter(Boolean).join(' · ')
    const cardPath = process.env.MEGA_BRAIN_CARD_PATH?.trim()
    const usageId = cardPath
      ? startAgentUsage(cardPath, new Date(startedAt), {
          label: itemId ? `${stageLabel} · ${itemId}` : stageLabel,
          provider: provider === 'chatgpt' ? 'codex' : 'claude',
          model: usageModel,
        })
      : undefined
    let usageFinished = false
    const finishUsage = (cost?: number) => {
      if (!cardPath || !usageId || usageFinished) return
      usageFinished = true
      finishAgentUsage(cardPath, usageId, cost)
    }
    const messages = cardPath ? taskMessageContext(cardPath) : undefined
    const prompt = `${options.prompt}${process.env.MEGA_BRAIN_KNOWLEDGE_CONTEXT ?? ''}${messages?.prompt ?? ''}`
    const fastModeArgs =
      process.env.MEGA_BRAIN_CLAUDE_FAST_MODE === '1' ? ['--settings', JSON.stringify({ fastMode: true })] : []
    const claudeArgs = [
      '-p',
      ...fastModeArgs,
      prompt,
      ...(sessionName ? ['--name', sessionName] : []),
      '--model',
      options.model,
      ...(options.model.toLowerCase().includes('fable') ? ['--fallback-model', 'opus'] : []),
      ...(options.effort ? ['--effort', options.effort] : []),
      '--json-schema',
      RESULT_SCHEMA,
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--tools',
      options.tools,
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose',
    ]
    const codexPrompt = `${prompt}\n\nAo terminar, responda somente com JSON válido no formato {"status":"done|failed|blocked","note":"resumo curto"}.`
    const codexModel = ['fable', 'opus', 'sonnet', 'haiku', 'default'].includes(options.model.toLowerCase())
      ? []
      : ['--model', options.model]
    const command = provider === 'chatgpt' ? codexBin() : claudeBin()
    const args =
      provider === 'chatgpt'
        ? [
            'exec',
            '--json',
            '--dangerously-bypass-approvals-and-sandbox',
            ...codexModel,
            ...(options.effort ? ['--config', `model_reasoning_effort="${options.effort}"`] : []),
            codexPrompt,
          ]
        : claudeArgs
    const checkpoint = itemCheckpoint(cardPath, options.cwd, options.prompt)
    const previous = process.env.MEGA_BRAIN_RESUMING_STAGE === '1' ? checkpoint.read() : undefined
    const providerName = provider === 'chatgpt' ? 'codex' : 'claude'
    const saved = previous?.provider === providerName ? previous : undefined
    const originalArgs = saved?.args ?? args
    checkpoint.save({ provider: providerName, args: originalArgs, sessionId: saved?.sessionId })
    const launchArgs = saved ? continuationArgs(providerName, originalArgs, saved.sessionId, messages?.prompt ?? '') : args
    const child = spawn(command, launchArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let buffer = ''
    child.on('spawn', () => messages?.acknowledge())
    if (cardPath) appendConversation(cardPath, { role: 'assistant', tool: `Executando ${itemId ?? 'task'}`, source: sessionName })
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const event = (() => { try { return record(JSON.parse(line)) } catch { return undefined } })()
        const sessionId = event?.type === 'thread.started' ? event.thread_id : event?.session_id
        if (typeof sessionId === 'string') checkpoint.save({ provider: providerName, args: originalArgs, sessionId })
      }
      if (cardPath) for (const line of lines) for (const entry of executionEntries(line)) appendConversation(cardPath, { ...entry, source: sessionName })
    })
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs)
    child.on('error', (error) => {
      checkpoint.clear()
      clearTimeout(timer)
      if (cardPath && buffer.trim()) for (const entry of executionEntries(buffer)) appendConversation(cardPath, { ...entry, source: sessionName })
      finishUsage()
      settle({
        status: 'failed',
        note: `Falha ao iniciar ${provider === 'chatgpt' ? 'ChatGPT' : 'Claude'}: ${error.message}`,
      })
    })
    child.on('close', (code, signal) => {
      if (!signal || timedOut) checkpoint.clear()
      clearTimeout(timer)
      if (cardPath && buffer.trim()) for (const entry of executionEntries(buffer)) appendConversation(cardPath, { ...entry, source: sessionName })
      if (timedOut) {
        finishUsage()
        settle({ status: 'failed', note: `Timeout após ${Math.round(options.timeoutMs / 60000)}min` })
        return
      }
      const result = provider === 'chatgpt' ? parseCodexResult(stdout) : parseResult(stdout)
      let reportedCost = result?.costUsd
      if (provider === 'claude' && reportedCost === undefined) {
        try {
          const rawCost = stdout.split('\n').flatMap(line => { try { return [record(JSON.parse(line))] } catch { return [] } }).reverse().find(event => event?.type === 'result')?.total_cost_usd
          if (typeof rawCost === 'number' && Number.isFinite(rawCost) && rawCost >= 0) reportedCost = rawCost
        } catch {
          // A malformed provider response can still be reported as a failed execution.
        }
      }
      finishUsage(reportedCost)
      if (result) {
        if (provider === 'claude' && result.rateLimited && options.model.toLowerCase().includes('fable')) {
          runClaudeItem({ ...options, model: 'opus' }).then(settle)
          return
        }
        settle(result)
        return
      }
      const tail = (stderr || stdout).trim().split('\n').slice(-2).join(' | ').slice(0, 200)
      settle({ status: 'failed', note: `Saída inválida do agente (exit ${code}): ${tail}` })
    })
  })
}
