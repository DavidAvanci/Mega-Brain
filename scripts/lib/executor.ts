import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

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
  maxTurns: number
  timeoutMs: number
}

function parseResult(stdout: string): ItemResult | null {
  let data: any
  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }
  const costUsd = typeof data.total_cost_usd === 'number' ? data.total_cost_usd : undefined
  const candidates = [data.structured_output, data.structuredOutput]
  if (typeof data.result === 'string') {
    try {
      candidates.push(JSON.parse(data.result))
    } catch {}
  }
  for (const candidate of candidates) {
    if (candidate && ['done', 'failed', 'blocked'].includes(candidate.status)) {
      return { status: candidate.status, note: String(candidate.note ?? ''), costUsd }
    }
  }
  if (data.is_error || data.subtype !== 'success') {
    const detail =
      typeof data.result === 'string' && data.result.trim()
        ? data.result.trim().replace(/\s+/g, ' ').slice(0, 300)
        : (data.subtype ?? 'desconhecido')
    return {
      status: 'failed',
      note: `Agente terminou com erro: ${detail}`,
      costUsd,
      rateLimited: data.error === 'rate_limit' || data.api_error_status === 429,
    }
  }
  return null
}

function parseStructuredText(text: string): ItemResult | null {
  const normalized = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const value = JSON.parse(normalized)
    if (value && ['done', 'failed', 'blocked'].includes(value.status)) {
      return { status: value.status, note: String(value.note ?? '') }
    }
  } catch {}
  const match = normalized.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const value = JSON.parse(match[0])
    return value && ['done', 'failed', 'blocked'].includes(value.status)
      ? { status: value.status, note: String(value.note ?? '') }
      : null
  } catch {
    return null
  }
}

function parseCodexResult(stdout: string): ItemResult | null {
  let message = ''
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line)
      if (event?.type === 'turn.failed' || event?.type === 'error') {
        return { status: 'failed', note: String(event.error?.message ?? event.message ?? 'Execução do ChatGPT falhou') }
      }
      if (event?.type === 'item.completed' && event.item?.type === 'agent_message') {
        message = String(event.item.text ?? '')
      }
    } catch {}
  }
  return parseStructuredText(message)
}

export function runClaudeItem(options: ClaudeItemOptions): Promise<ItemResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const settle = (result: ItemResult) => resolve({ ...result, durationMs: Date.now() - startedAt })
    const provider = process.env.MEGA_BRAIN_LLM_PROVIDER === 'chatgpt' ? 'chatgpt' : 'claude'
    const claudeArgs = [
      '-p', options.prompt,
      '--model', options.model,
      ...(options.model.toLowerCase().includes('fable') ? ['--fallback-model', 'opus'] : []),
      ...(options.effort ? ['--effort', options.effort] : []),
      '--json-schema', RESULT_SCHEMA,
      '--max-turns', String(options.maxTurns),
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--tools', options.tools,
      '--dangerously-skip-permissions',
      '--output-format', 'json',
    ]
    const codexPrompt = `${options.prompt}\n\nAo terminar, responda somente com JSON válido no formato {"status":"done|failed|blocked","note":"resumo curto"}.`
    const codexModel = ['fable', 'opus', 'sonnet', 'haiku', 'default'].includes(options.model.toLowerCase()) ? [] : ['--model', options.model]
    const command = provider === 'chatgpt' ? codexBin() : claudeBin()
    const args = provider === 'chatgpt'
      ? [
          'exec', '--json', '--dangerously-bypass-approvals-and-sandbox',
          ...codexModel,
          ...(options.effort ? ['--config', `model_reasoning_effort="${options.effort}"`] : []),
          codexPrompt,
        ]
      : claudeArgs
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      settle({ status: 'failed', note: `Falha ao iniciar ${provider === 'chatgpt' ? 'ChatGPT' : 'Claude'}: ${error.message}` })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (signal === 'SIGKILL') {
        settle({ status: 'failed', note: `Timeout após ${Math.round(options.timeoutMs / 60000)}min` })
        return
      }
      const result = provider === 'chatgpt' ? parseCodexResult(stdout) : parseResult(stdout)
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
