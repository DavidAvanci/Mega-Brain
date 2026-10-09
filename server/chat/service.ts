import { knowledgeContext, knowledgeAgentEnvironment } from '../knowledge/agent'
import { knowledgeRefs, type KnowledgeRef } from '../../shared/domain/knowledge'
import { readCard } from '../workspace/card-record'
import {
  appendConversation,
  executionEntries,
  pendingTaskMessages,
  taskConversation,
  taskMessageContext,
} from './task-conversation'
import { STAGES } from '../workspace/stage-catalog'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readTail, summarizeAgentInput } from '../agent-log'
import { claudeBin, codexBin } from '../agent-executable'
import { agentCwds } from '../agent-process'
import { readAgent } from '../workspace/stage-agent-status'
import { codexProfileEnvironment } from '../codex-profiles/service'
import { createWorkspacePathResolver } from '../workspace/path'
import type { ChatAgentSettings, ChatEntry, ChatEvent, ChatModelSelection } from '../../shared/contracts/chat'
import { parseChatModelSelection, readChatModelSelection, saveChatModelSelection } from './model-selection'
import { loadMegaBrainConfig, type MegaBrainConfig } from '../config'
import { nodeProcessRunner, type ProcessChild, type ProcessOwner, type ProcessRunner } from '../process'
import { assertTestWorkspace } from '../test-safety'
import { repositoryMentionContext } from '../repositories/mentions'
import { finishAgentUsage, startAgentUsage } from '../workspace/agent-usage'
import { redactDevEnvOutput } from '../modules/dev-environments/dev-env-logs'

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

export function chatEvent(line: string, terminal = false): ChatEvent | null {
  const event = jsonRecord(line)
  if (!event) return null
  if (event?.type === 'stream_event') {
    if (terminal) return null
    const stream = record(event.event)
    const delta = record(stream?.delta)
    if (stream?.type !== 'content_block_delta' || delta?.type !== 'text_delta') return null
    return { type: 'text', text: String(delta.text ?? '') }
  }
  if (event?.type === 'assistant') {
    const content = record(event.message)?.content
    const tool = Array.isArray(content) ? content.map(record).find((block) => block?.type === 'tool_use') : undefined
    if (tool)
      return {
        type: 'tool',
        tool:
          terminal && typeof record(tool.input)?.command === 'string'
            ? String(record(tool.input)?.command)
            : toolLabel(tool),
      }
    const text =
      terminal && Array.isArray(content)
        ? content
            .map(record)
            .filter((block) => block?.type === 'text')
            .map((block) => block?.text ?? '')
            .join('\n')
        : ''
    return text ? { type: 'text', text } : null
  }
  if (terminal && event.type === 'user') {
    const content = record(event.message)?.content
    const results = Array.isArray(content) ? content.map(record).filter((block) => block?.type === 'tool_result') : []
    const output = results
      .map((block) =>
        typeof block?.content === 'string'
          ? block.content
          : Array.isArray(block?.content)
            ? block.content
                .map(record)
                .map((part) => part?.text ?? '')
                .join('\n')
            : '',
      )
      .join('\n')
    if (output) return { type: 'output', text: output }
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
  if (['rodando', 'pausado'].includes(readAgent(path)?.status ?? ''))
    return 'O agente da etapa está rodando; espere ele terminar'
  if (terminalOpen(path)) return 'Há um Claude aberto no terminal dessa pasta; feche antes de usar o chat'
  return undefined
}

function chatArgs(text: string, session: string | undefined, model = 'default'): string[] {
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
    ...(model === 'default' ? [] : ['--model', model]),
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
  environment?: NodeJS.ProcessEnv,
  terminal = false,
  model = 'default',
): void {
  const usageId = startAgentUsage(path, new Date(), {
    label: terminal ? 'dev-environment' : 'chat',
    provider: 'claude',
  })
  let costUsd: number | undefined
  const child = runner.spawn(
    claudeBin(executable),
    chatArgs(text, terminal ? undefined : resolveSession(path, projectsRoot), model),
    {
      cwd: path,
      detached: terminal && process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...environment },
    },
  )
  owner?.own(child, { tree: terminal && process.platform !== 'win32', label: terminal ? 'dev-environment' : 'chat' })
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
      const usageEvent = jsonRecord(line)
      if (usageEvent?.type === 'result' && typeof usageEvent.total_cost_usd === 'number')
        costUsd = usageEvent.total_cost_usd
      const settings = settingsEvent(line)
      if (settings) emit(settings)
      const event = chatEvent(line, terminal)
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
    finishAgentUsage(path, usageId, costUsd)
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
  environment?: NodeJS.ProcessEnv,
  terminal = false,
  model = 'default',
): void {
  const usageId = startAgentUsage(path, new Date(), { label: terminal ? 'dev-environment' : 'chat', provider: 'codex' })
  const args = [
    'exec',
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    ...(model === 'default' ? [] : ['--model', model]),
    text,
  ]
  const child = runner.spawn(codexBin(executable), args, {
    cwd: path,
    detached: terminal && process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...environment },
  })
  owner?.own(child, { tree: terminal && process.platform !== 'win32', label: terminal ? 'dev-environment' : 'chat' })
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
        if (terminal && event?.type === 'item.started' && item?.type === 'command_execution') {
          emit({ type: 'tool', tool: String(item.command ?? 'Executando comando') })
        }
        if (
          terminal &&
          event?.type === 'item.completed' &&
          item?.type === 'command_execution' &&
          typeof item.aggregated_output === 'string'
        ) {
          emit({ type: 'output', text: item.aggregated_output })
        }
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
    finishAgentUsage(path, usageId)
    if (running.get(path) === child) running.delete(path)
    if (signal || aborted.has(child)) return finish({ type: 'done', error: 'Interrompido' })
    if (settled) return
    finish({ type: 'done', error: `O ChatGPT saiu sem responder (exit ${code ?? 'desconhecido'}).` })
  })
}

export interface ChatService {
  history(name: string): Promise<{
    sessionId: string | null
    entries: ChatEntry[]
    settings?: ChatAgentSettings | null
    selection?: ChatModelSelection
    executionRunning?: boolean
    pendingMessages?: number
  }>
  send(name: string, text: string, emit: (event: ChatEvent) => void, refs?: KnowledgeRef[], selection?: unknown): void
  abort(name: string): boolean
  shutdown?(): Promise<void>
}

type ChatServiceOptions = {
  purpose?: 'environment'
  busyPaths?: Set<string>
  preparePrompt?: (path: string, message: string) => string
  environment?: (path: string, name: string) => NodeJS.ProcessEnv
}

export function createChatService(
  config: Pick<MegaBrainConfig, 'workspaceDir' | 'directories' | 'executables'> &
    Partial<Pick<MegaBrainConfig, 'preferences'>>,
  runner: ProcessRunner = nodeProcessRunner,
  owner?: ProcessOwner,
  options: ChatServiceOptions = {},
): ChatService {
  const running = new Map<string, ProcessChild>()
  const aborted = new WeakSet<ProcessChild>()
  let closing = false
  const terminal = options.purpose === 'environment'
  const conversationPath = (path: string) => (terminal ? join(path, '.dev-env', 'agent') : path)
  const folderPath = (name: unknown): string => {
    const root = resolve(config.workspaceDir)
    assertTestWorkspace(root)
    return createWorkspacePathResolver(root).resolveCardFolder(name).path
  }
  return {
    async history(name) {
      const path = folderPath(name)
      const selection = readChatModelSelection(conversationPath(path), config.preferences?.llmProvider)
      if (terminal)
        return {
          sessionId: null,
          entries: taskConversation(conversationPath(path)),
          executionRunning: running.has(path),
          pendingMessages: 0,
          selection,
        }
      const projectsRoot = config.directories.claudeProjects
      const saved = taskConversation(path)
      const stages = STAGES.flatMap((stage) => {
        const file = join(path, `${stage.name}.jsonl`)
        return existsSync(file)
          ? readTail(file, TRANSCRIPT_TAIL_BYTES)
              .split('\n')
              .flatMap((line) => executionEntries(line).map((entry) => ({ ...entry, source: stage.name })))
          : []
      })
      const legacy =
        selection.provider === 'chatgpt' ? { entries: [], settings: null } : transcript(path, projectsRoot)
      return {
        sessionId: resolveSession(path, projectsRoot) ?? null,
        settings: legacy.settings,
        selection,
        entries: [...stages, ...(saved.length ? saved : legacy.entries)].slice(-500),
        executionRunning: readAgent(path)?.status === 'rodando',
        pendingMessages: pendingTaskMessages(path).length,
      }
    },
    send(name, text, emit, refs, requestedSelection) {
      if (closing) throw new Error('O serviço de chat está encerrando.')
      const path = folderPath(name)
      const selection =
        parseChatModelSelection(requestedSelection) ??
        readChatModelSelection(conversationPath(path), config.preferences?.llmProvider)
      const message = String(text ?? '').trim()
      if (!message) throw new Error('Mensagem vazia')
      if (message.length > 12_000) throw new Error('A mensagem deve ter no máximo 12000 caracteres')
      if (!terminal && ['rodando', 'pausado'].includes(readAgent(path)?.status ?? '')) {
        const prompt = knowledgeContext(
          repositoryMentionContext(message, config.preferences?.settingsFile),
          [...(readCard(path, String(name)).knowledgeRefs ?? []), ...knowledgeRefs(refs)],
          config.preferences?.settingsFile,
        )
        appendConversation(path, { role: 'user', text: message }, true, prompt)
        emit({ type: 'queued' })
        emit({ type: 'done' })
        return
      }
      const busy = busyReason(path, running)
      if (busy) throw new Error(busy)
      if (options.busyPaths?.has(path))
        throw new Error(
          'Já há um agente trabalhando neste card. Aguarde ou interrompa a execução antes de iniciar outra.',
        )
      const conversation = conversationPath(path)
      if (terminal) mkdirSync(conversation, { recursive: true, mode: 0o700 })
      saveChatModelSelection(conversation, selection)
      if (!terminal && !taskConversation(path).length && selection.provider !== 'chatgpt')
        for (const entry of transcript(path, config.directories.claudeProjects).entries) appendConversation(path, entry)
      const previous = taskConversation(conversation)
        .slice(-30)
        .map((entry) => entry.text ?? entry.tool ?? entry.output ?? '')
        .join('\n')
      const prior = terminal ? previous.slice(-12_000) : previous
      const messages = terminal ? { prompt: '', acknowledge: () => {} } : taskMessageContext(path)
      const contextualMessage = options.preparePrompt?.(path, message) ?? message
      const prompt = knowledgeContext(
        repositoryMentionContext(
          `${prior ? `Conversa e execuções anteriores desta task:\n${prior}\n\nNova mensagem do usuário:\n` : ''}${contextualMessage}${messages.prompt}`,
          config.preferences?.settingsFile,
        ),
        [...(readCard(path, String(name)).knowledgeRefs ?? []), ...knowledgeRefs(refs)],
        config.preferences?.settingsFile,
      )
      const profileEnvironment =
        selection.provider === 'chatgpt'
          ? codexProfileEnvironment(
              config.preferences?.settingsFile ??
                join(config.directories.home, '.config', 'mega-brain', 'settings.json'),
              undefined,
              config.directories.home,
            )
          : {}
      const environment = {
        ...profileEnvironment,
        ...knowledgeAgentEnvironment(config.preferences?.settingsFile, {
          kind: 'agent',
          name: selection.provider === 'chatgpt' ? 'Codex' : 'Claude',
          taskId: String(name),
          sessionId: randomUUID(),
        }),
        ...options.environment?.(path, String(name)),
      }
      const source = profileEnvironment.MEGA_BRAIN_CODEX_PROFILE_NAME
        ? `Codex · ${profileEnvironment.MEGA_BRAIN_CODEX_PROFILE_NAME}`
        : undefined
      appendConversation(conversation, {
        role: 'user',
        text: terminal ? redactDevEnvOutput(message) : message,
        ...(source ? { source } : {}),
      })
      let response = ''
      const persistAndEmit = (event: ChatEvent) => {
        if (terminal && (event.type === 'tool' || event.type === 'output') && response) {
          appendConversation(conversation, { role: 'assistant', text: response, ...(source ? { source } : {}) })
          response = ''
        }
        if (terminal && event.type === 'text') event = { ...event, text: redactDevEnvOutput(event.text) }
        if (terminal && event.type === 'output')
          event = { ...event, text: redactDevEnvOutput(event.text).slice(-20_000) }
        if (terminal && event.type === 'tool') event = { ...event, tool: redactDevEnvOutput(event.tool).slice(0, 4000) }
        if (terminal && event.type === 'done' && event.error)
          event = { ...event, error: redactDevEnvOutput(event.error) }
        if (event.type === 'text') response += event.text
        if (event.type === 'tool')
          appendConversation(conversation, { role: 'assistant', tool: event.tool, ...(source ? { source } : {}) })
        if (event.type === 'output') appendConversation(conversation, { role: 'assistant', output: event.text })
        if (event.type === 'done') {
          if (response)
            appendConversation(conversation, { role: 'assistant', text: response, ...(source ? { source } : {}) })
          response = ''
        }
        emit(event)
      }
      if (selection.provider === 'chatgpt')
        streamCodexChat(
          path,
          prompt,
          persistAndEmit,
          config.executables.codex,
          runner,
          running,
          aborted,
          owner,
          environment,
          terminal,
          selection.model,
        )
      else
        streamChat(
          path,
          prompt,
          persistAndEmit,
          config.directories.claudeProjects,
          config.executables.claude,
          runner,
          running,
          aborted,
          owner,
          environment,
          terminal,
          selection.model,
        )
      options.busyPaths?.add(path)
      running.get(path)?.once('close', () => options.busyPaths?.delete(path))
      messages.acknowledge()
    },
    abort(name) {
      const child = running.get(folderPath(name))
      if (child) {
        aborted.add(child)
        if (terminal && owner) void owner.stop(child)
        else child.kill('SIGTERM')
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
