import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readTail, summarizeAgentInput } from '../agent-log'
import { claudeBin, codexBin } from '../agent-executable'
import { agentCwds } from '../agent-process'
import { readAgent } from '../workspace/stage-agent-status'
import { createWorkspacePathResolver } from '../workspace/path'
import type { ChatAgentSettings, ChatEntry, ChatEvent } from '../../shared/contracts/chat'
import { loadMegaBrainConfig, type MegaBrainConfig } from '../config'
import { nodeProcessRunner, type ProcessChild, type ProcessOwner, type ProcessRunner } from '../process'
import { assertTestWorkspace } from '../test-safety'
import { repositoryMentionContext } from '../repositories/mentions'

const DEFAULT_PROJECTS_ROOT = loadMegaBrainConfig().directories.claudeProjects
const TRANSCRIPT_TAIL_BYTES = 512 * 1024
const HISTORY_LIMIT = 80

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function jsonRecord(line: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(line))
  } catch {
    return undefined
  }
}

export function sessionDir(cwd: string, projectsRoot = DEFAULT_PROJECTS_ROOT): string {
  return join(projectsRoot, cwd.replace(/[/.]/g, '-'))
}

export function resolveSession(path: string, projectsRoot = DEFAULT_PROJECTS_ROOT): string | undefined {
  const dir = sessionDir(path, projectsRoot)
  const fromAgent = readAgent(path)?.sessionId
  if (fromAgent && existsSync(join(dir, `${fromAgent}.jsonl`))) return fromAgent
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith('.jsonl'))
      .map((file) => ({ id: file.replace(/\.jsonl$/, ''), at: statSync(join(dir, file)).mtimeMs }))
      .sort((a, b) => b.at - a.at)[0]?.id
  } catch {
    return undefined
  }
}

export function parseTranscript(text: string): ChatEntry[] {
  const entries: ChatEntry[] = []
  for (const line of text.split('\n')) {
    const event = jsonRecord(line)
    if (!event || event.isSidechain) continue
    const content = record(event.message)?.content
    if (event?.type === 'user' && typeof content === 'string' && !content.startsWith('<')) {
      entries.push({ role: 'user', text: content })
    }
    if (event?.type !== 'assistant' || !Array.isArray(content)) continue
    for (const rawBlock of content) {
      const block = record(rawBlock)
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        entries.push({ role: 'assistant', text: block.text })
      }
      if (block?.type === 'tool_use') {
        entries.push({ role: 'assistant', tool: toolLabel(block) })
      }
    }
  }
  return entries
}

function settingsFromEvent(event: unknown): ChatAgentSettings | null {
  const parsed = record(event)
  if (parsed?.type !== 'assistant' || parsed.isSidechain) return null
  const model = record(parsed.message)?.model
  const effort = parsed.effort
  if (typeof model !== 'string' || !model.trim() || typeof effort !== 'string' || !effort.trim()) return null
  return { model: model.trim(), effort: effort.trim() }
}

/** Returns the settings from the most recent assistant response in a session. */
export function parseChatSettings(text: string): ChatAgentSettings | null {
  let settings: ChatAgentSettings | null = null
  for (const line of text.split('\n')) {
    try {
      settings = settingsFromEvent(jsonRecord(line)) ?? settings
    } catch {}
  }
  return settings
}

function settingsEvent(line: string): ChatEvent | null {
  try {
    const settings = settingsFromEvent(jsonRecord(line))
    return settings ? { type: 'settings', settings } : null
  } catch {
    return null
  }
}

function toolLabel(block: { name?: string; input?: Record<string, unknown> }): string {
  return [block.name, summarizeAgentInput(block.input)].filter(Boolean).join(': ')
}

export function chatEvent(line: string): ChatEvent | null {
  const event = jsonRecord(line)
  if (!event) return null
  if (event?.type === 'stream_event') {
    const stream = record(event.event)
    const delta = record(stream?.delta)
    if (stream?.type !== 'content_block_delta' || delta?.type !== 'text_delta') return null
    return { type: 'text', text: String(delta.text ?? '') }
  }
  if (event?.type === 'assistant') {
    const content = record(event.message)?.content
    const tool = Array.isArray(content) ? content.map(record).find((block) => block?.type === 'tool_use') : undefined
    return tool ? { type: 'tool', tool: toolLabel(tool) } : null
  }
  if (event?.type !== 'result') return null
  if (event.subtype === 'success' && !event.is_error) return { type: 'done' }
  const detail = typeof event.result === 'string' && event.result.trim() ? event.result : event.subtype
  return {
    type: 'done',
    error: String(detail ?? 'erro desconhecido')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 300),
  }
}

function transcript(path: string, projectsRoot: string): { entries: ChatEntry[]; settings: ChatAgentSettings | null } {
  const session = resolveSession(path, projectsRoot)
  if (!session) return { entries: [], settings: null }
  const file = join(sessionDir(path, projectsRoot), `${session}.jsonl`)
  if (!existsSync(file)) return { entries: [], settings: null }
  const content = readTail(file, TRANSCRIPT_TAIL_BYTES)
  return { entries: parseTranscript(content).slice(-HISTORY_LIMIT), settings: parseChatSettings(content) }
}

function terminalOpen(path: string): boolean {
  const real = realpathSync(path)
  for (const cwd of agentCwds()) if (cwd === real) return true
  return false
}

function busyReason(path: string, running: Map<string, ProcessChild>): string | undefined {
  if (running.has(path)) return 'Já há uma mensagem em andamento'
  if (readAgent(path)?.status === 'rodando') return 'O agente da etapa está rodando; espere ele terminar'
  if (terminalOpen(path)) return 'Há um Claude aberto no terminal dessa pasta; feche antes de usar o chat'
  return undefined
}

function chatArgs(text: string, session: string | undefined): string[] {
  return [
    '-p',
    text,
    ...(session ? ['--resume', session] : ['--session-id', randomUUID()]),
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--permission-mode',
    'bypassPermissions',
  ]
}

function streamChat(
  path: string,
  text: string,
  emit: (event: ChatEvent) => void,
  projectsRoot: string,
  executable: string | undefined,
  runner: ProcessRunner,
  running: Map<string, ProcessChild>,
  aborted: WeakSet<ProcessChild>,
  owner?: ProcessOwner,
): void {
  const child = runner.spawn(claudeBin(executable), chatArgs(text, resolveSession(path, projectsRoot)), {
    cwd: path,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  owner?.own(child, { label: 'chat' })
  running.set(path, child)
  let buffer = ''
  let settled = false
  const finish = (event: ChatEvent) => {
    if (settled) return
    settled = true
    emit(event)
  }
  child.stdout!.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const settings = settingsEvent(line)
      if (settings) emit(settings)
      const event = chatEvent(line)
      if (!event) continue
      if (event.type === 'done') finish(event)
      else emit(event)
    }
  })
  child.stderr!.on('data', () => {
    // stderr may contain user prompts, local paths, or provider diagnostics; never retain it.
  })
  child.on('error', () => finish({ type: 'done', error: 'Falha ao iniciar o agente Claude.' }))
  child.on('close', (code, signal) => {
    if (running.get(path) === child) running.delete(path)
    if (signal || aborted.has(child)) return finish({ type: 'done', error: 'Interrompido' })
    finish({ type: 'done', error: `O agente saiu sem responder (exit ${code ?? 'desconhecido'}).` })
  })
}

function streamCodexChat(
  path: string,
  text: string,
  emit: (event: ChatEvent) => void,
  executable: string | undefined,
  runner: ProcessRunner,
  running: Map<string, ProcessChild>,
  aborted: WeakSet<ProcessChild>,
  owner?: ProcessOwner,
): void {
  const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', text]
  const child = runner.spawn(codexBin(executable), args, {
    cwd: path,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  owner?.own(child, { label: 'chat' })
  running.set(path, child)
  let buffer = ''
  child.stderr!.on('data', () => {
    // Never retain raw provider stderr in process memory or surface it to the UI.
  })
  let settled = false
  const finish = (event: ChatEvent) => {
    if (settled) return
    settled = true
    emit(event)
  }
  child.stdout!.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const event = jsonRecord(line)
        const item = record(event?.item)
        const error = record(event?.error)
        if (event?.type === 'item.completed' && item?.type === 'agent_message' && item.text) {
          emit({ type: 'text', text: String(item.text) })
        } else if (event?.type === 'turn.completed') {
          finish({ type: 'done' })
        } else if (event?.type === 'turn.failed' || event?.type === 'error') {
          finish({ type: 'done', error: String(error?.message ?? event?.message ?? 'Falha no ChatGPT') })
        }
      } catch {}
    }
  })
  child.on('error', () => finish({ type: 'done', error: 'Falha ao iniciar a CLI do Codex.' }))
  child.on('close', (code, signal) => {
    if (running.get(path) === child) running.delete(path)
    if (signal || aborted.has(child)) return finish({ type: 'done', error: 'Interrompido' })
    if (settled) return
    finish({ type: 'done', error: `O ChatGPT saiu sem responder (exit ${code ?? 'desconhecido'}).` })
  })
}

export interface ChatService {
  history(
    name: string,
  ): Promise<{ sessionId: string | null; entries: ChatEntry[]; settings?: ChatAgentSettings | null }>
  send(name: string, text: string, emit: (event: ChatEvent) => void): void
  abort(name: string): boolean
  shutdown?(): Promise<void>
}

export function createChatService(
  config: Pick<MegaBrainConfig, 'workspaceDir' | 'directories' | 'executables'> &
    Partial<Pick<MegaBrainConfig, 'preferences'>>,
  runner: ProcessRunner = nodeProcessRunner,
  owner?: ProcessOwner,
): ChatService {
  const running = new Map<string, ProcessChild>()
  const aborted = new WeakSet<ProcessChild>()
  let closing = false
  const folderPath = (name: unknown): string => {
    const root = resolve(config.workspaceDir)
    assertTestWorkspace(root)
    return createWorkspacePathResolver(root).resolveCardFolder(name).path
  }
  return {
    async history(name) {
      const path = folderPath(name)
      if (config.preferences?.llmProvider === 'chatgpt') return { sessionId: null, entries: [], settings: null }
      const projectsRoot = config.directories.claudeProjects
      return { sessionId: resolveSession(path, projectsRoot) ?? null, ...transcript(path, projectsRoot) }
    },
    send(name, text, emit) {
      if (closing) throw new Error('O serviço de chat está encerrando.')
      const path = folderPath(name)
      const message = String(text ?? '').trim()
      if (!message) throw new Error('Mensagem vazia')
      const busy = busyReason(path, running)
      if (busy) throw new Error(busy)
      const prompt = repositoryMentionContext(message, config.preferences?.settingsFile)
      if (config.preferences?.llmProvider === 'chatgpt')
        streamCodexChat(path, prompt, emit, config.executables.codex, runner, running, aborted, owner)
      else
        streamChat(
          path,
          prompt,
          emit,
          config.directories.claudeProjects,
          config.executables.claude,
          runner,
          running,
          aborted,
          owner,
        )
    },
    abort(name) {
      const child = running.get(folderPath(name))
      if (child) {
        aborted.add(child)
        child.kill('SIGTERM')
      }
      return true
    },
    async shutdown() {
      if (closing) return
      closing = true
      const children = [...running.values()]
      running.clear()
      await Promise.allSettled(
        children.map(async (child) => {
          aborted.add(child)
          if (owner) await owner.stop(child)
          else child.kill('SIGTERM')
        }),
      )
    },
  }
}
