import { closeSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentProvider, AgentSession, AgentSessionsResponse, AgentStatus } from '../../shared/domain/agents'
import { agentProcesses, externalAgentCwd, type RunningAgentProcess } from '../agent-process'
import { assistantText, parseJsonRecord, readTail, record, summarizeAgentInput, toolUse } from '../agent-log'
import { activityVisualState, questionFromInput, questionFromText } from './activity'
import type { IslandVisualState } from '../../shared/domain/activity-island'
import type { CodexProfile } from '../../shared/domain/codex-profiles'
import { canonicalCodexHome } from '../codex-profiles/service'

const HEAD_BYTES = 192 * 1024
const TAIL_BYTES = 192 * 1024
const DEFAULT_HISTORY_LIMIT = 40
const ACTIVE_CODEX_WINDOW_MS = 5 * 60 * 1000
const PENDING_INPUT_WINDOW_MS = 24 * 60 * 60 * 1000
const SESSION_NAMES_CACHE_MS = 30 * 1000

interface SessionFile {
  path: string
  provider: AgentProvider
  birthtimeMs: number
  mtimeMs: number
  size: number
  codexHome?: string
  codexProfile?: CodexProfile
}

export interface AgentSessionServiceOptions {
  home: string
  claudeHome?: string
  claudeProjects: string
  codexHomes?: readonly string[]
  /** Read on each scan so edits to the profile registry take effect immediately. */
  codexProfiles?: () => readonly CodexProfile[]
  historyLimit?: number
  now?: () => Date
  processes?: () => RunningAgentProcess[]
  workspaceDir?: string
  worktreesDir?: string
  stopProcess?: (pid: number) => void
}

export interface AgentSessionService {
  list(): AgentSessionsResponse
  stop(id: string, codexProfileId?: string): void
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

function filesBelow(
  root: string,
  provider: AgentProvider,
  maxDepth: number,
  codexHome?: string,
  codexProfile?: CodexProfile,
): SessionFile[] {
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
          files.push({
            path,
            provider,
            birthtimeMs: stat.birthtimeMs,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            codexHome,
            codexProfile,
          })
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

/** Cache only the events used for public status, retaining a thinking marker without its text. */
function readSessionEvents(file: SessionFile): Record<string, unknown>[] | undefined {
  let head: string
  let tail: string
  try {
    head = readHead(file.path, HEAD_BYTES)
    tail = readTail(file.path, TAIL_BYTES)
  } catch {
    return undefined
  }
  return `${head}\n${tail}`.split('\n').flatMap((line) => {
    const event = parseJsonRecord(line)
    if (!event) return []
    const payload = record(event.payload)
    if (event.type === 'response_item' && payload?.type === 'reasoning')
      return [{ type: 'response_item', payload: { type: 'reasoning' } }]
    if (event.type === 'event_msg' && payload?.type === 'agent_reasoning')
      return [{ type: 'event_msg', payload: { type: 'agent_reasoning' } }]
    const message = record(event.message)
    if (message && Array.isArray(message.content))
      return [
        {
          ...event,
          message: {
            ...message,
            content: message.content.map((block) =>
              record(block)?.type === 'thinking' ? { type: 'thinking' } : block,
            ),
          },
        },
      ]
    return [event]
  })
}

function sessionFromFile(
  file: SessionFile,
  activeProcess: RunningAgentProcess | undefined,
  nowMs: number,
  events: readonly Record<string, unknown>[],
): AgentSession {
  let id = basename(file.path, '.jsonl')
  let cwd = ''
  let title: string | undefined
  let startedAt: string | undefined
  let activity: string | undefined
  let model: string | undefined
  let effort: string | undefined
  let failed = false
  let waiting = false
  let question: string | undefined
  let visualState: IslandVisualState = 'working'
  let codexTurnOpen = false
  let questionCallId: string | undefined
  let explicitQuestion = false
  let questionAskedAt = file.mtimeMs
  for (const event of events) {
    if (!event) continue
    const payload = record(event.payload)
    const message = record(event.message)
    const eventTime = Date.parse(String(event.timestamp ?? payload?.timestamp ?? ''))
    if (typeof event.sessionId === 'string') id = event.sessionId
    if (typeof event.session_id === 'string') id = event.session_id
    if (typeof payload?.session_id === 'string') id = payload.session_id
    if (typeof payload?.id === 'string' && event.type === 'session_meta') id = payload.id
    if (typeof event.cwd === 'string') cwd = event.cwd
    if (typeof payload?.cwd === 'string') cwd = payload.cwd
    if (!startedAt && typeof event.timestamp === 'string') startedAt = event.timestamp
    if (!startedAt && typeof payload?.timestamp === 'string') startedAt = payload.timestamp

    if (file.provider === 'claude') {
      if (event.type === 'assistant') {
        if (typeof message?.model === 'string') model = message.model
        if (typeof event.effort === 'string') effort = event.effort
      }
      if (
        !title &&
        event.type === 'queue-operation' &&
        event.operation === 'enqueue' &&
        typeof event.content === 'string'
      )
        title = event.content
      if (!title && event.type === 'user') title = eventText(message?.content)
      if (event.type === 'user') {
        waiting = false
        question = undefined
        explicitQuestion = false
        visualState = 'working'
        failed = false
      }
      if (event.type === 'assistant') {
        if (typeof message?.model === 'string' && message.model.trim()) model = message.model
        if (typeof event.effort === 'string' && event.effort.trim()) effort = event.effort
        const tool = toolUse(event)
        if (tool) {
          activity = [tool.name, summarizeAgentInput(record(tool.input))].filter(Boolean).join(': ')
          visualState = activityVisualState(activity)
          if (tool.name === 'AskUserQuestion') {
            question = questionFromInput(tool.input)
            waiting = Boolean(question)
            explicitQuestion = waiting
            questionAskedAt = Number.isFinite(eventTime) ? eventTime : file.mtimeMs
          } else {
            waiting = false
            explicitQuestion = false
          }
        } else if (message?.stop_reason === 'end_turn') {
          question = questionFromText(eventText(message.content))
          waiting = Boolean(question)
          explicitQuestion = false
          activity = waiting ? 'Aguardando sua resposta' : 'Turno concluído'
          visualState = waiting ? 'waiting' : 'idle'
        } else {
          const narration = assistantText(event)
          if (narration) activity = narration
          // Thinking is a state only; never expose thinking text in the island.
          const content = message?.content
          if (Array.isArray(content) && content.some((block) => record(block)?.type === 'thinking'))
            visualState = 'thinking'
        }
      }
      if (event.type === 'result') {
        if (event.is_error || event.subtype !== 'success') failed = true
        if (explicitQuestion) {
          waiting = false
          question = undefined
          explicitQuestion = false
        }
      }
    } else {
      if (event.type === 'turn_context') {
        if (typeof payload?.model === 'string' && payload.model.trim()) model = payload.model
        if (typeof payload?.effort === 'string' && payload.effort.trim()) effort = payload.effort
      }
      if (event.type === 'session_meta' && typeof payload?.model === 'string') model = payload.model
      if (typeof payload?.reasoning_effort === 'string') effort = payload.reasoning_effort
      if (typeof payload?.effort === 'string') effort = payload.effort
      if (!title && event.type === 'response_item' && payload?.type === 'message' && payload.role === 'user') {
        const candidate = eventText(payload.content)
        if (candidate && !candidate.trimStart().startsWith('<')) title = candidate
      }
      if (event.type === 'event_msg' && payload?.type === 'task_started') {
        codexTurnOpen = true
        waiting = false
        question = undefined
        explicitQuestion = false
        questionCallId = undefined
        failed = false
        visualState = 'working'
      }
      if (
        event.type === 'event_msg' &&
        ['task_complete', 'task_completed', 'turn_completed'].includes(String(payload?.type))
      ) {
        codexTurnOpen = false
        if (explicitQuestion) {
          waiting = false
          question = undefined
          explicitQuestion = false
          questionCallId = undefined
        }
        if (!waiting) visualState = 'idle'
      }
      if (event.type === 'turn.failed' || event.type === 'error') failed = true
      if (event.type === 'response_item' && payload) {
        if (payload.type === 'reasoning') visualState = 'thinking'
        if (payload.type === 'message' && payload.role === 'assistant') {
          const text = eventText(payload.content)
          if (payload.phase !== 'commentary') {
            question = questionFromText(text)
            waiting = Boolean(question)
            explicitQuestion = false
            if (waiting) visualState = 'waiting'
          }
        }
        if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
          const name = String(payload.name ?? '')
          let input: unknown = payload.input ?? payload.arguments
          if (typeof input === 'string') {
            try {
              input = JSON.parse(input)
            } catch {
              input = undefined
            }
          }
          activity = [name, summarizeAgentInput(record(input))].filter(Boolean).join(': ')
          // CLI tool arguments differ by provider; use commands to classify the
          // operation while keeping raw shell arguments out of the status label.
          const command = record(input)?.cmd
          visualState = activityVisualState(typeof command === 'string' ? `${activity} ${command}` : activity)
          if (/request_user_input$/.test(name)) {
            question = questionFromInput(input)
            waiting = Boolean(question)
            explicitQuestion = waiting
            questionAskedAt = Number.isFinite(eventTime) ? eventTime : file.mtimeMs
            questionCallId = typeof payload.call_id === 'string' ? payload.call_id : undefined
          }
        }
        if (
          payload.type === 'function_call_output' &&
          waiting &&
          explicitQuestion &&
          (!questionCallId || questionCallId === payload.call_id)
        ) {
          waiting = false
          question = undefined
          questionCallId = undefined
          explicitQuestion = false
          visualState = 'working'
        }
        const value = payload.command ?? payload.text
        if (typeof value === 'string' && payload.type !== 'reasoning') {
          activity = value.slice(0, 300)
          visualState = activityVisualState(activity)
        }
      }
      if (event.type === 'event_msg' && payload?.type === 'request_user_input') {
        question = questionFromInput(payload)
        waiting = Boolean(question)
        explicitQuestion = waiting
        questionCallId = typeof payload.call_id === 'string' ? payload.call_id : undefined
        questionAskedAt = Number.isFinite(eventTime) ? eventTime : file.mtimeMs
        if (waiting) visualState = 'waiting'
      }
    }
  }
  const freshOpenCodexTurn = file.provider === 'codex' && codexTurnOpen && nowMs - file.mtimeMs < ACTIVE_CODEX_WINDOW_MS
  const freshQuestion =
    waiting &&
    nowMs - (explicitQuestion ? questionAskedAt : file.mtimeMs) <
      (explicitQuestion ? PENDING_INPUT_WINDOW_MS : ACTIVE_CODEX_WINDOW_MS)
  const active = Boolean(activeProcess) || (freshOpenCodexTurn && (!waiting || freshQuestion)) || freshQuestion
  const status: AgentStatus = failed ? 'erro' : active ? (waiting ? 'aguardando' : 'rodando') : 'concluido'
  const fallbackStartedAt = new Date(file.birthtimeMs || file.mtimeMs).toISOString()
  return {
    id,
    provider: file.provider,
    model,
    effort,
    status,
    cwd,
    title: cleanTitle(title, cwd),
    startedAt: startedAt ?? fallbackStartedAt,
    updatedAt: new Date(file.mtimeMs).toISOString(),
    activity,
    visualState:
      status === 'aguardando'
        ? 'waiting'
        : status === 'erro'
          ? 'error'
          : status === 'concluido'
            ? 'complete'
            : visualState,
    ...(status === 'aguardando' && question ? { question } : {}),
    pid: activeProcess?.pid,
    ...(file.codexProfile
      ? {
          codexProfileId: file.codexProfile.id,
          codexProfileName: file.codexProfile.name,
          codexProfileColor: file.codexProfile.color,
        }
      : {}),
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

function cardIdFromWorkspaceCwd(
  cwd: string,
  workspaceDir: string | undefined,
  cardIds: Set<string>,
): string | undefined {
  if (!workspaceDir || !cwd) return undefined
  let realWorkspaceDir: string
  try {
    realWorkspaceDir = realpathSync(workspaceDir)
  } catch {
    return undefined
  }
  const withinRoot = relative(realWorkspaceDir, resolve(cwd))
  if (!withinRoot || withinRoot === '..' || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) return undefined
  return canonicalCardId(withinRoot.split(sep)[0], cardIds)
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

function canonicalCardId(candidate: string | undefined, cardIds: Set<string>): string | undefined {
  if (!candidate) return undefined
  if (cardIds.has(candidate)) return candidate
  const key = candidate.toLowerCase()
  const matches = [...cardIds].filter((cardId) => cardId.toLowerCase() === key)
  return matches.length === 1 ? matches[0] : undefined
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
          names.set(`codex:${codexHome}:${entry.id}`, entry.thread_name.trim())
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
  let cachedHomeKey = ''
  const cachedEvents = new Map<string, { mtimeMs: number; size: number; events: Record<string, unknown>[] }>()
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
    const profiles = options.codexProfiles?.() ?? []
    const homePath = (home: string) => canonicalCodexHome(home, options.home)
    const profileByHome = new Map(profiles.map((profile) => [homePath(profile.home), profile]))
    const codexHomes = uniqueExisting(
      profiles.length
        ? profiles.map(({ home }) => homePath(home))
        : (options.codexHomes ?? [join(options.home, '.codex')]).map(homePath),
    )
    const files = [
      ...filesBelow(options.claudeProjects, 'claude', 2),
      ...codexHomes.flatMap((home) => [
        ...filesBelow(join(home, 'sessions'), 'codex', 5, home, profileByHome.get(home)),
        ...filesBelow(join(home, 'archived_sessions'), 'codex', 1, home, profileByHome.get(home)),
      ]),
    ]
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      // Retain all potentially running/waiting files across homes before limiting history.
      .filter((file, index) => index < historyLimit || now.getTime() - file.mtimeMs < PENDING_INPUT_WINDOW_MS)

    const matchedPids = new Set<number>()
    const homeBySession = new Map<AgentSession, string>()
    const candidatePaths = new Set(files.map(({ path }) => path))
    for (const path of cachedEvents.keys()) if (!candidatePaths.has(path)) cachedEvents.delete(path)
    const sessions = files.flatMap((file) => {
      const cached = cachedEvents.get(file.path)
      const events =
        cached?.mtimeMs === file.mtimeMs && cached.size === file.size ? cached.events : readSessionEvents(file)
      if (!events) return []
      cachedEvents.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, events })
      const candidate = sessionFromFile(file, undefined, now.getTime(), events)
      const key = `${candidate.provider}:${candidate.cwd}`
      const process = activeByProviderAndCwd.get(key)?.find((candidateProcess) => {
        if (matchedPids.has(candidateProcess.pid)) return false
        if (candidate.provider !== 'codex') return true
        if (candidateProcess.codexHome) return homePath(candidateProcess.codexHome) === file.codexHome
        if (candidateProcess.codexProfileId) return candidateProcess.codexProfileId === file.codexProfile?.id
        // A shared cwd does not identify the home of a multi-profile process.
        return codexHomes.length === 1
      })
      const session = process ? sessionFromFile(file, process, now.getTime(), events) : candidate
      if (process) matchedPids.add(process.pid)
      if (session && file.codexHome) homeBySession.set(session, file.codexHome)
      return session ? [session] : []
    })

    for (const process of running) {
      if (matchedPids.has(process.pid)) continue
      const profile =
        process.provider === 'codex'
          ? process.codexHome
            ? (profileByHome.get(homePath(process.codexHome)) ??
              profiles.find(({ id }) => id === process.codexProfileId))
            : profiles.find(({ id }) => id === process.codexProfileId)
          : undefined
      const session: AgentSession = {
        id: `${process.provider}-${process.pid}`,
        provider: process.provider,
        status: 'rodando',
        cwd: process.cwd,
        title: basename(process.cwd) || process.cwd,
        startedAt: process.startedAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
        pid: process.pid,
        ...(profile
          ? { codexProfileId: profile.id, codexProfileName: profile.name, codexProfileColor: profile.color }
          : {}),
      }
      if (process.codexHome) homeBySession.set(session, homePath(process.codexHome))
      sessions.unshift(session)
    }

    sessions.sort((left, right) => {
      const activeDifference =
        Number(['rodando', 'aguardando'].includes(right.status)) -
        Number(['rodando', 'aguardando'].includes(left.status))
      return activeDifference || right.updatedAt.localeCompare(left.updatedAt)
    })
    const homeKey = codexHomes.join('\0')
    if (homeKey !== cachedHomeKey || now.getTime() - namesCachedAt >= SESSION_NAMES_CACHE_MS) {
      cachedNames = readSessionNames(claudeHome, codexHomes)
      namesCachedAt = now.getTime()
      cachedHomeKey = homeKey
    }
    const seen = new Set<string>()
    let historicalCount = 0
    return {
      sessions: sessions
        .filter((session) => {
          const identity = `${session.provider}:${session.codexProfileId ?? homeBySession.get(session) ?? ''}:${session.id}`
          if (seen.has(identity)) return false
          seen.add(identity)
          if (!['rodando', 'aguardando'].includes(session.status) && historicalCount++ >= historyLimit) return false
          return true
        })
        .flatMap((session) => {
          const name = cachedNames.get(
            session.provider === 'codex' ? `codex:${homeBySession.get(session)}:${session.id}` : `claude:${session.id}`,
          )
          if (isInternalResourcesSession(session, name)) return []
          const normalizedCwd = normalizedSessionCwd(session.cwd)
          const worktreeCardId =
            normalizedCwd && worktreesRoot ? cardIdFromWorktreeCwd(normalizedCwd, worktreesRoot) : undefined
          const namedCardId = /^(.*?)\s+·\s+/.exec(name ?? '')?.[1]
          const cardId =
            cardByCwd.get(session.cwd) ??
            (normalizedCwd ? cardIdFromWorkspaceCwd(normalizedCwd, options.workspaceDir, cardIds) : undefined) ??
            canonicalCardId(namedCardId, cardIds) ??
            canonicalCardId(worktreeCardId, cardIds)
          const displayName = name ?? (session.provider === 'codex' ? cardId : undefined)
          return [{ ...session, ...(displayName ? { name: displayName } : {}), ...(cardId ? { cardId } : {}) }]
        }),
      scannedAt: now.toISOString(),
    }
  }
  return {
    list,
    stop(id, codexProfileId) {
      const candidates = list().sessions.filter(
        (candidate) => candidate.id === id && (!codexProfileId || candidate.codexProfileId === codexProfileId),
      )
      if (candidates.length > 1)
        throw new Error('Há sessões com o mesmo identificador em perfis diferentes. Escolha o perfil do agente.')
      const session = candidates[0]
      if (!session || !['rodando', 'aguardando'].includes(session.status) || !session.pid) {
        throw new Error('A sessão não possui um processo ativo para interromper')
      }
      const liveProcess = (options.processes ?? (() => agentProcesses('/proc', true)))().find(
        (candidate) =>
          candidate.pid === session.pid && candidate.provider === session.provider && candidate.cwd === session.cwd,
      )
      if (!liveProcess) throw new Error('O processo do agente não está mais em execução')
      const profile = options.codexProfiles?.().find(({ id }) => id === session.codexProfileId)
      if (
        profile &&
        ((liveProcess.codexHome &&
          liveProcess.codexProfileId !== profile.id &&
          canonicalCodexHome(liveProcess.codexHome, options.home) !== canonicalCodexHome(profile.home, options.home)) ||
          (liveProcess.codexProfileId && liveProcess.codexProfileId !== profile.id))
      )
        throw new Error('O processo do agente mudou de perfil. Atualize a lista antes de interromper.')
      ;(options.stopProcess ?? ((pid: number) => process.kill(pid, 'SIGTERM')))(liveProcess.pid)
    },
  }
}
