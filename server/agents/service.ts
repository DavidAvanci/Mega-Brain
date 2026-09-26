import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentProvider, AgentSession, AgentSessionsResponse, AgentStatus } from '../../shared/domain/agents'
import { agentProcesses, externalAgentCwd, type RunningAgentProcess } from '../agent-process'
import { parseJsonRecord, readTail, record, summarizeAgentInput, toolUse } from '../agent-log'

const HEAD_BYTES = 192 * 1024
const TAIL_BYTES = 192 * 1024
const DEFAULT_HISTORY_LIMIT = 40
const ACTIVE_CODEX_WINDOW_MS = 5 * 60 * 1000
const SESSION_NAMES_CACHE_MS = 30 * 1000

interface SessionFile {
  path: string
  provider: AgentProvider
  birthtimeMs: number
  mtimeMs: number
}

export interface AgentSessionServiceOptions {
  home: string
  claudeHome?: string
  claudeProjects: string
  codexHomes?: readonly string[]
  historyLimit?: number
  now?: () => Date
  processes?: () => RunningAgentProcess[]
  workspaceDir?: string
  worktreesDir?: string
  stopProcess?: (pid: number) => void
}

export interface AgentSessionService {
  list(): AgentSessionsResponse
  stop(id: string): void
}

function readHead(path: string, bytes: number): string {
  const size = Math.min(statSync(path).size, bytes)
  const buffer = Buffer.alloc(size)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buffer, 0, size, 0)
  } finally {
    closeSync(fd)
  }
  return buffer.toString('utf8')
}

function filesBelow(root: string, provider: AgentProvider, maxDepth: number): SessionFile[] {
  const files: SessionFile[] = []
  const visit = (directory: string, depth: number) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = statSync(path)
          files.push({ path, provider, birthtimeMs: stat.birthtimeMs, mtimeMs: stat.mtimeMs })
        } catch {}
      }
    }
  }
  visit(root, 0)
  return files
}

function eventText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  return value
    .map((item) => {
      const part = record(item)
      return typeof part?.text === 'string' ? part.text : undefined
    })
    .filter(Boolean)
    .join(' ')
}

function cleanTitle(value: string | undefined, cwd: string): string {
  const clean = value
    ?.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean ? clean.slice(0, 160) : basename(cwd) || cwd || 'Sessão sem título'
}

function sessionFromFile(
  file: SessionFile,
  activeProcess: RunningAgentProcess | undefined,
  nowMs: number,
): AgentSession | undefined {
  let head: string
  let tail: string
  try {
    head = readHead(file.path, HEAD_BYTES)
    tail = readTail(file.path, TAIL_BYTES)
  } catch {
    return undefined
  }
  const events = `${head}\n${tail}`.split('\n').map(parseJsonRecord).filter(Boolean)
  let id = basename(file.path, '.jsonl')
  let cwd = ''
  let title: string | undefined
  let startedAt: string | undefined
  let activity: string | undefined
  let failed = false
  let waiting = false
  let codexTurnOpen = false
  for (const event of events) {
    if (!event) continue
    const payload = record(event.payload)
    const message = record(event.message)
    if (typeof event.sessionId === 'string') id = event.sessionId
    if (typeof event.session_id === 'string') id = event.session_id
    if (typeof payload?.session_id === 'string') id = payload.session_id
    if (typeof payload?.id === 'string' && event.type === 'session_meta') id = payload.id
    if (typeof event.cwd === 'string') cwd = event.cwd
    if (typeof payload?.cwd === 'string') cwd = payload.cwd
    if (!startedAt && typeof event.timestamp === 'string') startedAt = event.timestamp
    if (!startedAt && typeof payload?.timestamp === 'string') startedAt = payload.timestamp

    if (file.provider === 'claude') {
      if (
        !title &&
        event.type === 'queue-operation' &&
        event.operation === 'enqueue' &&
        typeof event.content === 'string'
      )
        title = event.content
      if (!title && event.type === 'user') title = eventText(message?.content)
      if (event.type === 'user') waiting = false
      if (event.type === 'assistant') {
        waiting = message?.stop_reason === 'end_turn'
        const tool = toolUse(event)
        if (tool) activity = [tool.name, summarizeAgentInput(record(tool.input))].filter(Boolean).join(': ')
      }
      if (event.type === 'result' && (event.is_error || event.subtype !== 'success')) failed = true
    } else {
      if (!title && event.type === 'response_item' && payload?.type === 'message' && payload.role === 'user') {
        const candidate = eventText(payload.content)
        if (candidate && !candidate.trimStart().startsWith('<')) title = candidate
      }
      if (event.type === 'event_msg' && payload?.type === 'task_started') codexTurnOpen = true
      if (
        event.type === 'event_msg' &&
        ['task_complete', 'task_completed', 'turn_completed'].includes(String(payload?.type))
      )
        codexTurnOpen = false
      if (event.type === 'turn.failed' || event.type === 'error') failed = true
      if (event.type === 'response_item' && payload) {
        const value = payload.command ?? payload.text
        if (typeof value === 'string') activity = value.slice(0, 300)
      }
    }
  }
  const freshOpenCodexTurn = file.provider === 'codex' && codexTurnOpen && nowMs - file.mtimeMs < ACTIVE_CODEX_WINDOW_MS
  const active = Boolean(activeProcess) || freshOpenCodexTurn
  const status: AgentStatus = active ? (waiting ? 'aguardando' : 'rodando') : failed ? 'erro' : 'concluido'
  const fallbackStartedAt = new Date(file.birthtimeMs || file.mtimeMs).toISOString()
  return {
    id,
    provider: file.provider,
    status,
    cwd,
    title: cleanTitle(title, cwd),
    startedAt: startedAt ?? fallbackStartedAt,
    updatedAt: new Date(file.mtimeMs).toISOString(),
    activity,
    pid: activeProcess?.pid,
  }
}

function uniqueExisting(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

/** Returns the first path segment only when cwd is contained in the worktrees root. */
export function cardIdFromWorktreeCwd(cwd: string, worktreesRoot: string): string | undefined {
  if (!cwd || !worktreesRoot || !isAbsolute(cwd) || !isAbsolute(worktreesRoot)) return undefined
  const withinRoot = relative(resolve(worktreesRoot), resolve(cwd))
  if (!withinRoot || withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot))
    return undefined
  return withinRoot.split(sep)[0] || undefined
}

function realWorktreesRoot(worktreesDir: string | undefined): string | undefined {
  if (!worktreesDir) return undefined
  try {
    return realpathSync(worktreesDir)
  } catch {
    return undefined
  }
}

function normalizedSessionCwd(cwd: string): string | undefined {
  if (!isAbsolute(cwd)) return undefined
  try {
    return realpathSync(cwd)
  } catch {
    // A historical session can outlive its nested worktree directory. Resolve the
    // nearest existing ancestor to prevent a surviving symlink from escaping root.
    let ancestor = resolve(cwd)
    const missing: string[] = []
    while (true) {
      try {
        const existing = realpathSync(ancestor)
        return resolve(existing, ...missing.reverse())
      } catch {
        const parent = resolve(ancestor, '..')
        if (parent === ancestor) return undefined
        missing.push(basename(ancestor))
        ancestor = parent
      }
    }
  }
}

function existingCardIds(workspaceDir: string | undefined): Set<string> {
  if (!workspaceDir) return new Set()
  try {
    return new Set(
      readdirSync(workspaceDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name),
    )
  } catch {
    return new Set()
  }
}

function cardIdsByCwd(
  workspaceDir: string | undefined,
  processes: readonly RunningAgentProcess[],
  cardIds: Set<string>,
): Map<string, string> {
  const result = new Map<string, string>()
  if (!workspaceDir || !processes.length) return result
  for (const process of processes) {
    for (const cardId of cardIds) {
      if (externalAgentCwd(join(workspaceDir, cardId), new Set([process.cwd]))) {
        result.set(process.cwd, cardId)
        break
      }
    }
  }
  return result
}

function readSessionNames(claudeHome: string, codexHomes: readonly string[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const codexHome of codexHomes) {
    try {
      for (const line of readTail(join(codexHome, 'session_index.jsonl'), 512 * 1024).split('\n')) {
        const entry = parseJsonRecord(line)
        if (typeof entry?.id === 'string' && typeof entry.thread_name === 'string' && entry.thread_name.trim()) {
          names.set(`codex:${entry.id}`, entry.thread_name.trim())
        }
      }
    } catch {}
  }
  let entries
  try {
    entries = readdirSync(join(claudeHome, 'sessions'), { withFileTypes: true })
  } catch {
    return names
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const metadata = record(JSON.parse(readFileSync(join(claudeHome, 'sessions', entry.name), 'utf8')))
      if (typeof metadata?.sessionId === 'string' && typeof metadata.name === 'string' && metadata.name.trim()) {
        names.set(`claude:${metadata.sessionId}`, metadata.name.trim())
      }
    } catch {}
  }
  return names
}

/** Codex keeps this internal session open to manage app resources; it is not user work. */
function isInternalResourcesSession(session: AgentSession, name: string | undefined): boolean {
  return session.provider === 'codex' && (name ?? session.title).trim().toLocaleLowerCase() === 'resources'
}

export function createAgentSessionService(options: AgentSessionServiceOptions): AgentSessionService {
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT
  const claudeHome = options.claudeHome ?? join(options.home, '.claude')
  let cachedNames = new Map<string, string>()
  let namesCachedAt = 0
  const list = (): AgentSessionsResponse => {
    const now = (options.now ?? (() => new Date()))()
    const running = (options.processes ?? agentProcesses)()
    const cardIds = existingCardIds(options.workspaceDir)
    const worktreesRoot = realWorktreesRoot(options.worktreesDir)
    const cardByCwd = cardIdsByCwd(options.workspaceDir, running, cardIds)
    const activeByProviderAndCwd = new Map<string, RunningAgentProcess[]>()
    for (const process of running) {
      const key = `${process.provider}:${process.cwd}`
      const processes = activeByProviderAndCwd.get(key)
      if (processes) processes.push(process)
      else activeByProviderAndCwd.set(key, [process])
    }
    const codexHomes = uniqueExisting(options.codexHomes ?? [join(options.home, '.codex')])
    const files = [
      ...filesBelow(options.claudeProjects, 'claude', 2),
      ...codexHomes.flatMap((home) => [
        ...filesBelow(join(home, 'sessions'), 'codex', 5),
        ...filesBelow(join(home, 'archived_sessions'), 'codex', 1),
      ]),
    ]
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, historyLimit)

    const matchedPids = new Set<number>()
    const sessions = files.flatMap((file) => {
      const candidate = sessionFromFile(file, undefined, now.getTime())
      if (!candidate) return []
      const key = `${candidate.provider}:${candidate.cwd}`
      const process = activeByProviderAndCwd.get(key)?.find(({ pid }) => !matchedPids.has(pid))
      const session = process ? sessionFromFile(file, process, now.getTime()) : candidate
      if (process) matchedPids.add(process.pid)
      return session ? [session] : []
    })

    for (const process of running) {
      if (matchedPids.has(process.pid)) continue
      sessions.unshift({
        id: `${process.provider}-${process.pid}`,
        provider: process.provider,
        status: 'rodando',
        cwd: process.cwd,
        title: basename(process.cwd) || process.cwd,
        startedAt: process.startedAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
        pid: process.pid,
      })
    }

    sessions.sort((left, right) => {
      const activeDifference =
        Number(['rodando', 'aguardando'].includes(right.status)) -
        Number(['rodando', 'aguardando'].includes(left.status))
      return activeDifference || right.updatedAt.localeCompare(left.updatedAt)
    })
    if (now.getTime() - namesCachedAt >= SESSION_NAMES_CACHE_MS) {
      cachedNames = readSessionNames(claudeHome, codexHomes)
      namesCachedAt = now.getTime()
    }
    const seen = new Set<string>()
    return {
      sessions: sessions
        .filter((session) => {
          if (seen.has(session.id)) return false
          seen.add(session.id)
          return true
        })
        .flatMap((session) => {
          const name = cachedNames.get(`${session.provider}:${session.id}`)
          if (isInternalResourcesSession(session, name)) return []
          const normalizedCwd = worktreesRoot ? normalizedSessionCwd(session.cwd) : undefined
          const worktreeCardId =
            normalizedCwd && worktreesRoot ? cardIdFromWorktreeCwd(normalizedCwd, worktreesRoot) : undefined
          const cardId =
            cardByCwd.get(session.cwd) ?? (worktreeCardId && cardIds.has(worktreeCardId) ? worktreeCardId : undefined)
          return [{ ...session, ...(name ? { name } : {}), ...(cardId ? { cardId } : {}) }]
        }),
      scannedAt: now.toISOString(),
    }
  }
  return {
    list,
    stop(id) {
      const session = list().sessions.find((candidate) => candidate.id === id)
      if (!session || !['rodando', 'aguardando'].includes(session.status) || !session.pid) {
        throw new Error('A sessão não possui um processo ativo para interromper')
      }
      const liveProcess = (options.processes ?? agentProcesses)().find(
        (candidate) =>
          candidate.pid === session.pid && candidate.provider === session.provider && candidate.cwd === session.cwd,
      )
      if (!liveProcess) throw new Error('O processo do agente não está mais em execução')
      ;(options.stopProcess ?? ((pid: number) => process.kill(pid, 'SIGTERM')))(liveProcess.pid)
    },
  }
}
