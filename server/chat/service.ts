import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { claudeBin, claudeCwds, codexBin, readAgent, readTail, summarizeInput } from '../workspace/service'
import { createWorkspacePathResolver } from '../workspace/path'
import type { ChatAgentSettings, ChatEntry, ChatEvent } from '../../src/types'
import { loadMegaBrainConfig, type MegaBrainConfig } from '../config'
import { nodeProcessRunner, type ProcessChild, type ProcessOwner, type ProcessRunner } from '../process'
import { assertTestWorkspace } from '../test-safety'

const DEFAULT_PROJECTS_ROOT = loadMegaBrainConfig().directories.claudeProjects
const TRANSCRIPT_TAIL_BYTES = 512 * 1024
const HISTORY_LIMIT = 80

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
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.isSidechain) continue
    const content = event?.message?.content
    if (event?.type === 'user' && typeof content === 'string' && !content.startsWith('<')) {
      entries.push({ role: 'user', text: content })
    }
    if (event?.type !== 'assistant' || !Array.isArray(content)) continue
    for (const block of content) {
      if (block?.type === 'text' && String(block.text ?? '').trim()) {
        entries.push({ role: 'assistant', text: block.text })
      }
      if (block?.type === 'tool_use') {
        entries.push({ role: 'assistant', tool: toolLabel(block) })
      }
    }
  }
  return entries
}

function settingsFromEvent(event: any): ChatAgentSettings | null {
  if (event?.type !== 'assistant' || event?.isSidechain) return null
  const model = event.message?.model
  const effort = event.effort
  if (typeof model !== 'string' || !model.trim() || typeof effort !== 'string' || !effort.trim()) return null
  return { model: model.trim(), effort: effort.trim() }
}

/** Returns the settings from the most recent assistant response in a session. */
export function parseChatSettings(text: string): ChatAgentSettings | null {
  let settings: ChatAgentSettings | null = null
  for (const line of text.split('\n')) {
    try {
      settings = settingsFromEvent(JSON.parse(line)) ?? settings
    } catch {}
  }
  return settings
}

function settingsEvent(line: string): ChatEvent | null {
  try {
    const settings = settingsFromEvent(JSON.parse(line))
    return settings ? { type: 'settings', settings } : null
  } catch {
    return null
  }
}

function toolLabel(block: { name?: string; input?: Record<string, unknown> }): string {
  return [block.name, summarizeInput(block.input)].filter(Boolean).join(': ')
}

export function chatEvent(line: string): ChatEvent | null {
  let event: any
  try {
    event = JSON.parse(line)
  } catch {
    return null
  }
  if (event?.type === 'stream_event') {
    const delta = event.event?.delta
    if (event.event?.type !== 'content_block_delta' || delta?.type !== 'text_delta') return null
    return { type: 'text', text: String(delta.text ?? '') }
  }
  if (event?.type === 'assistant') {
    const tool = event.message?.content?.find?.((block: any) => block?.type === 'tool_use')
    return tool ? { type: 'tool', tool: toolLabel(tool) } : null
  }
  if (event?.type !== 'result') return null
  if (event.subtype === 'success' && !event.is_error) return { type: 'done' }
  const detail = typeof event.result === 'string' && event.result.trim() ? event.result : event.subtype
  return { type: 'done', error: String(detail ?? 'erro desconhecido').trim().replace(/\s+/g, ' ').slice(0, 300) }
}

function transcript(path: string, projectsRoot: string): { entries: ChatEntry[]; settings: ChatAgentSettings | null } {
  const session = resolveSession(path, projectsRoot)
  if (!session) return { entries: [], settings: null }
  const file = join(sessionDir(path, projectsRoot), `${session}.jsonl`)
  if (!existsSync(file)) return { entries: [], settings: null }
  const content = readTail(file, TRANSCRIPT_TAIL_BYTES)
  return { entries: parseTranscript(content).slice(-HISTORY_LIMIT), settings: parseChatSettings(content) }
}

const running = new Map<string, ProcessChild>()
const aborted = new WeakSet<ProcessChild>()

function terminalOpen(path: string): boolean {
  const real = realpathSync(path)
  for (const cwd of claudeCwds()) if (cwd === real) return true
  return false
}

function busyReason(path: string): string | undefined {
  if (running.has(path)) return 'Já há uma mensagem em andamento'
  if (readAgent(path)?.status === 'rodando') return 'O agente da etapa está rodando; espere ele terminar'
  if (terminalOpen(path)) return 'Há um Claude aberto no terminal dessa pasta; feche antes de usar o chat'
  return undefined
}

function chatArgs(text: string, session: string | undefined): string[] {
  return [
    '-p', text,
    ...(session ? ['--resume', session] : ['--session-id', randomUUID()]),
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--dangerously-skip-permissions',
  ]
}

function streamChat(path: string, text: string, emit: (event: ChatEvent) => void, projectsRoot: string, executable: string | undefined, runner: ProcessRunner, owner?: ProcessOwner): void {
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
    running.delete(path)
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
  let stderr = ''
  child.stderr!.on('data', (chunk) => (stderr += chunk))
  child.on('error', (error) => finish({ type: 'done', error: `Falha ao spawnar claude: ${error.message}` }))
  child.on('close', (code, signal) => {
    if (signal || aborted.has(child)) return finish({ type: 'done', error: 'Interrompido' })
    const tail = stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 200)
    finish({ type: 'done', error: `O agente saiu sem responder (exit ${code})${tail ? `: ${tail}` : ''}` })
  })
}

function streamCodexChat(path: string, text: string, emit: (event: ChatEvent) => void, executable: string | undefined, runner: ProcessRunner, owner?: ProcessOwner): void {
  const child = runner.spawn(codexBin(executable), ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', text], {
    cwd: path,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  owner?.own(child, { label: 'chat' })
  running.set(path, child)
  let buffer = ''
  let stderr = ''
  let settled = false
  const finish = (event: ChatEvent) => {
    if (settled) return
    settled = true
    running.delete(path)
    emit(event)
  }
  child.stdout!.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const event = JSON.parse(line)
        if (event?.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
          emit({ type: 'text', text: String(event.item.text) })
        } else if (event?.type === 'turn.completed') {
          finish({ type: 'done' })
        } else if (event?.type === 'turn.failed' || event?.type === 'error') {
          finish({ type: 'done', error: String(event.error?.message ?? event.message ?? 'Falha no ChatGPT') })
        }
      } catch {}
    }
  })
  child.stderr!.on('data', (chunk) => (stderr += chunk))
  child.on('error', (error) => finish({ type: 'done', error: `Falha ao iniciar ChatGPT: ${error.message}` }))
  child.on('close', (code, signal) => {
    if (signal || aborted.has(child)) return finish({ type: 'done', error: 'Interrompido' })
    if (settled) return
    const tail = stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 200)
    finish({ type: 'done', error: `O ChatGPT saiu sem responder (exit ${code})${tail ? `: ${tail}` : ''}` })
  })
}

export interface ChatService { history(name: string): Promise<{ sessionId: string | null; entries: ChatEntry[]; settings?: ChatAgentSettings | null }>; send(name: string, text: string, emit: (event: ChatEvent) => void): void; abort(name: string): boolean }

export function createChatService(config: Pick<MegaBrainConfig, 'workspaceDir' | 'directories' | 'executables'> & Partial<Pick<MegaBrainConfig, 'preferences'>>, runner: ProcessRunner = nodeProcessRunner, owner?: ProcessOwner): ChatService {
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
      const history = transcript(path, projectsRoot)
      return { sessionId: resolveSession(path, projectsRoot) ?? null, ...history }
    },
    send(name, text, emit) {
      const path = folderPath(name)
      const message = String(text ?? '').trim()
      if (!message) throw new Error('Mensagem vazia')
      const busy = busyReason(path)
      if (busy) throw new Error(busy)
      if (config.preferences?.llmProvider === 'chatgpt') streamCodexChat(path, message, emit, config.executables.codex, runner, owner)
      else streamChat(path, message, emit, config.directories.claudeProjects, config.executables.claude, runner, owner)
    },
    abort(name) { const child = running.get(folderPath(name)); if (child) { aborted.add(child); child.kill('SIGTERM') }; return true },
  }
}
