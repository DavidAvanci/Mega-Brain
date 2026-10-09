import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentInfo, AgentSession } from '../../shared/domain/agents'
import {
  DEFAULT_ISLAND_DISPLAY,
  type IslandActivity,
  type IslandDisplaySettings,
  type IslandIntent,
  type IslandVisualState,
} from '../../shared/domain/activity-island'
import type { MegaBrainConfig } from '../config'
import { legacyJsonHandler, type ApiHandler } from '../contracts'
import { readCard } from '../workspace/card-record'
import { readAgent } from '../workspace/stage-agent-status'
import type { ChatService } from '../chat/service'
import type { CodexProfiles } from '../../shared/domain/codex-profiles'
import { appendConversation } from '../chat/task-conversation'
import { activityVisualState, questionFromInput, questionFromText } from '../agents/activity'
import { parseJsonRecord, readTail, record, toolUse } from '../agent-log'

const RECENT_DURATION_MS = 15_000
const MESSAGE_LIMIT = 12_000

export function validateDisplay(value: unknown): Partial<IslandDisplaySettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuração da ilha inválida')
  const input = value as Record<string, unknown>
  const result: Partial<IslandDisplaySettings> = {}
  for (const key of [
    'enabled',
    'taskSounds',
    'animations',
    'autoExpandOnWaiting',
    'compactOthers',
    'showActivity',
    'showProfileBadge',
  ] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'boolean') throw new Error(`Valor inválido: ${key}`)
    result[key] = input[key]
  }
  if (input.style !== undefined) {
    if (input.style !== 'clean' && input.style !== 'detailed') throw new Error('Estilo inválido')
    result.style = input.style
  }
  if (input.petAppearance !== undefined) {
    if (!['auto', 'codex', 'claude'].includes(String(input.petAppearance))) throw new Error('Mascote inválido')
    result.petAppearance = input.petAppearance as IslandDisplaySettings['petAppearance']
  }
  for (const key of ['runningColor', 'thinkingColor', 'waitingColor', 'successColor', 'errorColor'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(input[key])) throw new Error(`Cor inválida: ${key}`)
    result[key] = input[key]
  }
  if (input.monitorId !== undefined) {
    if (typeof input.monitorId !== 'string' || input.monitorId.length > 500) throw new Error('Monitor inválido')
    result.monitorId = input.monitorId
  }
  if (input.hiddenCodexProfileIds !== undefined) {
    const ids = input.hiddenCodexProfileIds
    if (
      !Array.isArray(ids) ||
      ids.length > 20 ||
      !ids.every((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id))
    )
      throw new Error('Perfis da ilha inválidos')
    result.hiddenCodexProfileIds = [...new Set(ids)]
  }
  for (const [key, min, max] of [
    ['fontSize', 9, 14],
    ['completionHeight', 54, 140],
    ['maxHeight', 220, 600],
    ['maxWidth', 520, 900],
    ['petSize', 16, 40],
    ['animationSpeed', 25, 200],
    ['cornerRadius', 12, 40],
    ['compactWidth', 360, 600],
  ] as const) {
    if (input[key] === undefined) continue
    const number = input[key]
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max)
      throw new Error(`Valor inválido: ${key}`)
    result[key] = number
  }
  return result
}

function visualState(agent: AgentInfo): IslandVisualState {
  if (agent.status === 'aguardando') return 'waiting'
  if (agent.status === 'erro') return 'error'
  if (agent.status === 'concluido') return 'complete'
  if (agent.status === 'morto') return 'idle'
  return agent.visualState ?? activityVisualState(agent.activity ?? agent.phase)
}

export function projectActivity(
  card: { name: string; title: string; agents: AgentInfo[] },
  includeFinished = false,
): IslandActivity[] {
  return card.agents.flatMap((agent, index) => {
    if (agent.status === 'pausado') return []
    if (!includeFinished && agent.status !== 'rodando' && agent.status !== 'aguardando') return []
    return [
      {
        taskId: `${card.name}:${agent.codexProfileId ? `${agent.codexProfileId}:` : ''}${agent.sessionId ?? agent.stage ?? index}`,
        cardId: card.name,
        title: card.title,
        agent: agent.provider ?? 'claude',
        status:
          agent.status === 'aguardando'
            ? 'waiting'
            : agent.status === 'concluido'
              ? 'complete'
              : agent.status === 'erro'
                ? 'error'
                : agent.status === 'morto'
                  ? 'stopped'
                  : 'running',
        activity: agent.activity ?? agent.phase,
        stage: agent.stage,
        checked: agent.progress?.done ?? 0,
        total: agent.progress?.total ?? 0,
        events: [],
        visualState: visualState(agent),
        question: agent.question,
        sessionId: agent.sessionId,
        codexProfileId: agent.codexProfileId,
        codexProfileName: agent.codexProfileName,
        codexProfileColor: agent.codexProfileColor,
      },
    ]
  })
}

/** Only public assistant text and question tool inputs are displayed. */
function stageQuestion(path: string, stage?: string): string | undefined {
  if (!stage || !/^[a-z0-9-]+$/.test(stage)) return undefined
  try {
    let question: string | undefined
    for (const line of readTail(join(path, `${stage}.jsonl`), 64 * 1024).split('\n')) {
      const event = parseJsonRecord(line)
      if (!event) continue
      if (event.type === 'user') question = undefined
      const tool = toolUse(event)
      if (tool) question = tool.name === 'AskUserQuestion' ? questionFromInput(tool.input) : undefined
      const item = record(event.item)
      if (event.type === 'item.started' && item?.type === 'command_execution') question = undefined
      if (event.type === 'item.completed' && item?.type === 'agent_message')
        question = questionFromText(String(item.text ?? ''))
      if (event.type === 'assistant' && record(event.message)?.stop_reason === 'end_turn') {
        const content = record(event.message)?.content
        if (Array.isArray(content)) {
          const text = content
            .map(record)
            .filter((block) => block?.type === 'text')
            .map((block) => block?.text)
            .join('\n')
          question = questionFromText(text)
        }
      }
      const payload = record(event.payload)
      if (event.type === 'response_item' && payload?.type === 'function_call') {
        if (/request_user_input$/.test(String(payload.name ?? ''))) {
          let input: unknown = payload.arguments
          try {
            if (typeof input === 'string') input = JSON.parse(input)
          } catch {
            input = undefined
          }
          question = questionFromInput(input)
        } else question = undefined
      }
      if (event.type === 'response_item' && payload?.type === 'function_call_output') question = undefined
    }
    return question
  } catch {
    return undefined
  }
}

export interface ActivityIslandOptions {
  chat?: Pick<ChatService, 'send'>
  now?: () => number
  codexProfiles?: () => CodexProfiles
}

/** Observes agents without advancing stages, starting processes or fetching PRs. */
export function activityIslandHttp(
  config: MegaBrainConfig,
  sessions: () => readonly AgentSession[],
  options: ActivityIslandOptions = {},
): ApiHandler {
  const file = join(dirname(config.preferences.settingsFile), 'activity-island.json')
  let display = { ...DEFAULT_ISLAND_DISPLAY }
  let intent: IslandIntent | null = null
  let loaded = false
  let previous = new Map<string, IslandActivity>()
  const recent = new Map<string, { activity: IslandActivity; at: number }>()
  function settings() {
    if (!loaded) {
      try {
        display = { ...display, ...validateDisplay(JSON.parse(readFileSync(file, 'utf8'))) }
      } catch {
        /* Use defaults for absent or invalid saved settings. */
      }
      loaded = true
    }
    return display
  }
  function snapshot() {
    const profiles = options.codexProfiles?.() ?? { profiles: [], activeId: '' }
    const profileById = new Map(profiles.profiles.map((profile) => [profile.id, profile]))
    const sessionKey = (session: AgentSession) => `${session.provider}:${session.codexProfileId ?? ''}:${session.id}`
    const allSessions = sessions()
    const activeSessions = allSessions.filter(
      (session) => session.status === 'rodando' || session.status === 'aguardando',
    )
    const included = new Set<string>()
    const candidates: IslandActivity[] = []
    const replyCards = new Map<string, string>()
    if (existsSync(config.workspaceDir)) {
      for (const entry of readdirSync(config.workspaceDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const path = join(config.workspaceDir, entry.name)
        const card = readCard(path, entry.name)
        const stage = readAgent(path)
        const linked = allSessions.filter((session) => session.cardId === entry.name)
        if (stage?.status === 'pausado') {
          for (const session of linked) included.add(sessionKey(session))
          continue
        }
        // A matching cwd alone does not prove that an external CLI is owned by this workflow.
        const match = stage?.sessionId
          ? activeSessions.find(
              (session) =>
                session.cardId === entry.name &&
                session.id === stage.sessionId &&
                (!stage.codexProfileId || session.codexProfileId === stage.codexProfileId) &&
                (stage.status === 'rodando' || (stage.status === 'concluido' && session.status === 'aguardando')),
            )
          : undefined
        if (stage) {
          const question = match?.question ?? stageQuestion(path, stage.stage)
          const agent: AgentInfo = {
            ...stage,
            provider: stage.provider ?? (config.preferences.llmProvider === 'chatgpt' ? 'codex' : 'claude'),
            ...(match
              ? {
                  provider: match.provider,
                  status: match.status,
                  sessionId: match.id,
                  activity: match.activity ?? stage.activity,
                  visualState: match.visualState,
                  codexProfileId: match.codexProfileId ?? stage.codexProfileId,
                  codexProfileName: match.codexProfileName ?? stage.codexProfileName,
                  codexProfileColor: match.codexProfileColor ?? stage.codexProfileColor,
                }
              : {}),
            ...(question && (stage.status === 'rodando' || match?.status === 'aguardando')
              ? { status: 'aguardando', question }
              : {}),
          }
          const activity = projectActivity({ name: entry.name, title: card.title, agents: [agent] }, true)[0]
          if (!activity) continue
          activity.replyMode = stage.status === 'rodando' || match?.status === 'aguardando' ? 'card' : 'external'
          if (activity.replyMode === 'card') replyCards.set(activity.taskId, entry.name)
          candidates.push(activity)
        }
        for (const session of linked) {
          included.add(sessionKey(session))
          if (session === match) continue
          const activity = projectActivity(
            { name: entry.name, title: card.title, agents: [{ ...session, sessionId: session.id }] },
            true,
          )[0]
          activity.replyMode = 'external'
          if (session.provider === 'codex' && /^[a-f0-9-]{36}$/i.test(session.id)) activity.threadId = session.id
          candidates.push(activity)
        }
      }
    }
    for (const session of allSessions) {
      if (included.has(sessionKey(session))) continue
      candidates.push({
        taskId: `${session.provider}:${session.codexProfileId ? `${session.codexProfileId}:` : ''}${session.id}`,
        threadId: session.provider === 'codex' && /^[a-f0-9-]{36}$/i.test(session.id) ? session.id : undefined,
        title: session.name ?? session.title,
        project: basename(session.cwd),
        agent: session.provider,
        status:
          session.status === 'aguardando'
            ? 'waiting'
            : session.status === 'concluido'
              ? 'complete'
              : session.status === 'erro'
                ? 'error'
                : session.status === 'morto'
                  ? 'stopped'
                  : 'running',
        activity: session.activity,
        visualState: visualState(session),
        question: session.question,
        replyMode: 'external',
        sessionId: session.id,
        codexProfileId: session.codexProfileId,
        codexProfileName: session.codexProfileName,
        codexProfileColor: session.codexProfileColor,
        checked: 0,
        total: 0,
        events: [],
      })
    }
    const live = candidates.filter((activity) => activity.status === 'running' || activity.status === 'waiting')
    for (const activity of candidates) {
      const profile = activity.codexProfileId ? profileById.get(activity.codexProfileId) : undefined
      if (profile) {
        activity.codexProfileName = profile.name
        activity.codexProfileColor = profile.color
      }
    }
    const current = new Map(live.map((activity) => [activity.taskId, activity]))
    const now = (options.now ?? Date.now)()
    for (const [taskId, prior] of previous) {
      if (current.has(taskId)) continue
      const finished = candidates.find((activity) => activity.taskId === taskId)
      recent.set(taskId, {
        activity: {
          ...(finished ?? prior),
          status: finished?.status ?? 'stopped',
          visualState: finished?.visualState ?? 'idle',
          replyMode: 'external',
          question: undefined,
        },
        at: now,
      })
    }
    for (const [taskId, entry] of recent)
      if (current.has(taskId) || now - entry.at >= RECENT_DURATION_MS) recent.delete(taskId)
    while (recent.size > 10) recent.delete(recent.keys().next().value!)
    previous = current
    live.sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'))
    const display = settings()
    const visible = (activity: IslandActivity) =>
      !activity.codexProfileId || !display.hiddenCodexProfileIds.includes(activity.codexProfileId)
    return {
      live: live.filter(visible),
      recent: [...recent.values()]
        .reverse()
        .map((entry) => entry.activity)
        .filter(visible),
      display,
      codexProfiles: profiles.profiles,
      activeCodexProfileId: profiles.activeId,
      replyCards,
    }
  }
  return legacyJsonHandler(async (request) => {
    let body: unknown
    if (request.path === '/api/activity-island/settings') {
      settings()
      if (request.method === 'PUT' || request.method === 'PATCH') {
        let patch: Partial<IslandDisplaySettings>
        try {
          patch = validateDisplay(request.body)
        } catch (error) {
          return { status: 400, body: { error: (error as Error).message } }
        }
        const next = { ...display, ...patch }
        mkdirSync(dirname(file), { recursive: true })
        const temp = `${file}.${randomUUID()}.tmp`
        writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
        renameSync(temp, file)
        display = next
      }
      body = display
    } else if (request.path === '/api/activity-intent') {
      if (request.method === 'POST') {
        const input = request.body as Partial<IslandIntent> | null
        if (
          !input ||
          !['main', 'settings', 'task', 'agents'].includes(input.target ?? '') ||
          (input.target === 'task' && (typeof input.taskId !== 'string' || !input.taskId || input.taskId.length > 500))
        )
          return { status: 400, body: { error: 'Destino da ilha inválido' } }
        intent = {
          id: randomUUID(),
          target: input.target!,
          ...(input.target === 'task' ? { taskId: input.taskId } : {}),
        }
      }
      body = intent
      if (request.method === 'GET') intent = null
    } else if (request.path === '/api/activity-island/reply') {
      const input = record(request.body)
      if (
        request.method !== 'POST' ||
        typeof input?.taskId !== 'string' ||
        !input.taskId ||
        input.taskId.length > 500 ||
        typeof input.message !== 'string' ||
        !input.message.trim() ||
        input.message.length > MESSAGE_LIMIT
      )
        return { status: 400, body: { error: 'Informe uma execução e uma mensagem de até 12000 caracteres.' } }
      const current = snapshot()
      const activity = current.live.find((candidate) => candidate.taskId === input.taskId)
      if (!activity)
        return { status: 409, body: { error: 'Esta execução mudou ou terminou. Atualize a ilha e abra a conversa.' } }
      const cardId = current.replyCards.get(activity.taskId)
      if (!cardId || !options.chat)
        return {
          status: 409,
          body: { error: 'Esta sessão é externa. Abra a conversa original para responder às perguntas e permissões.' },
        }
      const result: { delivery: 'queued' | 'sent' } = { delivery: 'sent' }
      let immediateError: string | undefined
      let dispatching = true
      try {
        options.chat.send(cardId, input.message.trim(), (event) => {
          if (event.type === 'queued') result.delivery = 'queued'
          if (event.type === 'done' && event.error) {
            if (dispatching) immediateError = event.error
            else
              appendConversation(join(config.workspaceDir, cardId), {
                role: 'assistant',
                text: 'Não foi possível enviar a mensagem da ilha. Abra o chat do card para tentar novamente.',
                source: 'Ilha dinâmica',
              })
          }
        })
      } catch (error) {
        return {
          status: 409,
          body: { error: error instanceof Error ? error.message : 'Não foi possível enviar a mensagem.' },
        }
      } finally {
        dispatching = false
      }
      if (immediateError) return { status: 409, body: { error: immediateError } }
      body = {
        ...result,
        message:
          result.delivery === 'queued'
            ? 'Mensagem pendente para a próxima chamada do agente. Você pode acompanhá-la no chat do card.'
            : 'Mensagem enviada ao chat do card. Acompanhe a resposta na conversa.',
      }
    } else {
      const { live, recent, display, codexProfiles, activeCodexProfileId } = snapshot()
      body = { live, recent, display, codexProfiles, activeCodexProfileId }
    }
    return { status: 200, body, headers: { 'Content-Type': 'application/json' } }
  })
}
