import { useSyncExternalStore } from 'react'
import { ApiError, apiClient } from './apiClient'
import { reportDesktopApiFailure } from './desktopConnection'
import {
  STATUSES,
  type AgentInfo,
  type Card,
  type ChatAgentSettings,
  type ChatEntry,
  type ChatEvent,
  type BoardSettings,
  type EditorDiscovery,
  type MegaBrainSettings,
  type DevEnvInfo,
  type FlowLevel,
  type PrLinks,
  type PrState,
  type Status,
} from './types'

const LEGACY_TITLES_KEY = 'mega-brain-titles'
const LEGACY_STATUSES_KEY = 'mega-brain-statuses'
const POLL_INTERVAL = 5000

interface WorkspaceFolder {
  name: string
  path: string
  createdAt: string
  updatedAt?: string
  title: string
  description: string
  status: string
  flow?: FlowLevel
  agents?: AgentInfo[] | null
  devEnv?: DevEnvInfo | null
  prs?: PrLinks | null
  prStates?: Record<string, PrState> | null
}

export interface CardsState {
  cards: Card[]
  error: string | null
  loaded: boolean
}

let state: CardsState = { cards: [], error: null, loaded: false }
const listeners = new Set<() => void>()
const USER_ACTION_WINDOW_MS = 10_000
const userInitiatedStatusChanges = new Map<string, { status: Status; expiresAt: number }>()

function setState(next: Partial<CardsState>): void {
  state = { ...state, ...next }
  listeners.forEach((notify) => notify())
}

const JIRA_KEY = /^(?!MB-)[A-Z][A-Z0-9]*-\d+$/i
let jiraStatuses: Record<string, string> = {}

async function fetchJiraStatuses(folders: WorkspaceFolder[]): Promise<void> {
  const keys = folders.map((f) => f.name).filter((name) => JIRA_KEY.test(name))
  if (!keys.length) {
    jiraStatuses = {}
    return
  }
  try {
    jiraStatuses = await apiClient().json(`/api/jira/statuses?keys=${encodeURIComponent(keys.join(','))}`)
  } catch (error) {
    reportDesktopApiFailure(error)
  }
}

function statusOf(folder: WorkspaceFolder): Status {
  return STATUSES.includes(folder.status as Status) ? (folder.status as Status) : 'a-fazer'
}

function toCards(folders: WorkspaceFolder[]): Card[] {
  return folders.map((f) => ({
    id: f.name,
    title: f.title,
    description: f.description,
    folder: f.path,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    status: statusOf(f),
    flow: f.flow ?? 'dificil',
    jiraStatus: jiraStatuses[f.name.toUpperCase()],
    agents: f.agents ?? undefined,
    devEnv: f.devEnv ?? undefined,
    prs: f.prs ?? undefined,
    prStates: f.prStates ?? undefined,
  }))
}

async function readJson<T>(path: string, fallback: string, options?: { method?: string; body?: unknown }): Promise<T> {
  try {
    return await apiClient().json<T>(path, options)
  } catch (error) {
    reportDesktopApiFailure(error)
    // Existing UI messages name the failed action when a proxy/server returns
    // an empty error response. Keep server-provided messages intact.
    if (error instanceof ApiError && error.message === `Request failed (HTTP ${error.status})`) {
      throw new Error(`${fallback} (HTTP ${error.status})`)
    }
    throw error
  }
}

function updateCard(
  name: string,
  patch: Partial<Pick<Card, 'title' | 'description' | 'status' | 'flow'>>,
  fallback = 'Falha ao atualizar o card',
) {
  return readJson('/api/workspace/update', fallback, {
    method: 'POST',
    body: { name, ...patch },
  })
}

async function migrateLegacy(folders: WorkspaceFolder[]): Promise<boolean> {
  const titles = JSON.parse(localStorage.getItem(LEGACY_TITLES_KEY) ?? 'null')
  const statuses = JSON.parse(localStorage.getItem(LEGACY_STATUSES_KEY) ?? 'null')
  if (!titles && !statuses) return false
  await Promise.all(
    folders.map((f) => {
      const title = titles?.[f.name]
      const status = statuses?.[f.name]
      if (!title && !status) return
      return updateCard(f.name, { title, status }).catch(() => {})
    }),
  )
  localStorage.removeItem(LEGACY_TITLES_KEY)
  localStorage.removeItem(LEGACY_STATUSES_KEY)
  return true
}

export async function refresh(): Promise<void> {
  try {
    const folders = await readJson<WorkspaceFolder[]>('/api/workspace', 'Falha ao listar o workspace')
    if (await migrateLegacy(folders)) return refresh()
    setState({ cards: toCards(folders), error: null, loaded: true })
    await fetchJiraStatuses(folders)
    setState({ cards: toCards(folders) })
  } catch (error) {
    reportDesktopApiFailure(error)
    setState({ error: error instanceof Error ? error.message : String(error), loaded: true })
  }
}

export async function fetchBoardSettings(): Promise<BoardSettings> {
  return (await fetchMegaBrainSettings()).stages
}

export async function saveBoardSettings(stages: BoardSettings): Promise<BoardSettings> {
  const current = await fetchMegaBrainSettings()
  return (await saveMegaBrainSettings({ ...current, stages })).stages
}

export async function fetchMegaBrainSettings(): Promise<MegaBrainSettings> {
  return readJson<MegaBrainSettings>('/api/workspace/settings', 'Falha ao carregar configurações')
}

export async function fetchDetectedEditors(): Promise<EditorDiscovery> {
  return readJson<EditorDiscovery>('/api/workspace/settings/editors', 'Falha ao detectar os editores instalados')
}

export async function saveMegaBrainSettings(settings: MegaBrainSettings): Promise<MegaBrainSettings> {
  return readJson<MegaBrainSettings>('/api/workspace/settings', 'Falha ao salvar configurações', {
    method: 'POST',
    body: settings,
  })
}

export async function createCard(title: string, description: string, flow: FlowLevel = 'dificil'): Promise<void> {
  await readJson('/api/workspace', 'Falha ao criar pasta da task', {
    method: 'POST',
    body: { title, description, flow },
  })
  await refresh()
}

interface JiraReadyIssue {
  key: string
  summary: string
  description: string
}

export async function syncJiraCards(): Promise<number> {
  const issues = await readJson<JiraReadyIssue[]>('/api/jira/ready', 'Falha ao buscar cards do Jira')
  const existing = new Set(state.cards.map((card) => card.id.toUpperCase()))
  const missing = issues.filter((issue) => !existing.has(issue.key.toUpperCase()))
  await Promise.all(
    missing.map(async (issue) => {
      await readJson('/api/workspace', `Falha ao criar o card ${issue.key}`, {
        method: 'POST',
        body: { name: issue.key, title: issue.summary, description: issue.description },
      })
    }),
  )
  await refresh()
  return missing.length
}

export async function deleteCard(name: string): Promise<void> {
  await readJson('/api/workspace/delete', 'Falha ao excluir a pasta', {
    method: 'POST',
    body: { name },
  })
  await refresh()
}

const AGENT_STATUSES: ReadonlySet<Status> = new Set([
  'planejando',
  'desenvolvendo',
  'auto-testing',
  'staging',
  'aguardando-deploy',
])

const JIRA_STATUS_BY_STATUS: Partial<Record<Status, string>> = {
  desenvolvendo: 'em desenvolvimento',
  'code-review': 'CODE REVIEW',
  staging: 'STAGING',
  'aguardando-deploy': 'AGUARDANDO DEPLOY',
  producao: 'EM PRODUÇÃO',
}

async function syncJiraStatus(id: string, status: Status): Promise<void> {
  const jiraStatus = JIRA_STATUS_BY_STATUS[status]
  if (!jiraStatus || !JIRA_KEY.test(id)) return
  const data = await readJson<{ status?: string }>('/api/jira/transition', `Falha ao mover ${id} para "${jiraStatus}" no Jira`, {
    method: 'POST',
    body: { key: id, status: jiraStatus },
  })
  if (data.status) jiraStatuses[id.toUpperCase()] = data.status
}

export function moveCard(id: string, status: Status): void {
  userInitiatedStatusChanges.set(id, { status, expiresAt: Date.now() + USER_ACTION_WINDOW_MS })
  setState({
    cards: state.cards.map((c) => {
      if (c.id !== id) return c
      const startingAgent = AGENT_STATUSES.has(status) && c.status !== status
      const external = (c.agents ?? []).filter((agent) => !agent.stage)
      return {
        ...c,
        status,
        agents: startingAgent
          ? [{ status: 'rodando' as const, phase: 'Iniciando agente' }, ...external]
          : c.agents,
      }
    }),
  })
  updateCard(id, { status }, 'Falha ao mover o card')
    .then(() => syncJiraStatus(id, status))
    .then(() => refresh())
    .catch((error) => setState({ error: error instanceof Error ? error.message : String(error) }))
}

export function consumeUserInitiatedStatusChange(id: string, status: Status): boolean {
  const change = userInitiatedStatusChanges.get(id)
  if (!change) return false
  userInitiatedStatusChanges.delete(id)
  return change.status === status && change.expiresAt >= Date.now()
}

export function setCardFlow(id: string, flow: FlowLevel): void {
  setState({ cards: state.cards.map((card) => card.id === id ? { ...card, flow } : card) })
  updateCard(id, { flow }, 'Falha ao alterar o fluxo do card')
    .then(() => refresh())
    .catch((error) => setState({ error: error instanceof Error ? error.message : String(error) }))
}

export interface WorktreeRepoInfo {
  name: string
  path: string
  repository: string
  remote?: string
  branch: string
  head: { hash: string; shortHash: string; subject: string; committedAt: string }
  base?: { ref: string; hash: string; shortHash: string; inferred: boolean; createdAt?: string }
  dirty: boolean
  error?: string
}

export interface CardDetail {
  files: Record<string, string | null>
  repos: WorktreeRepoInfo[]
}

export async function fetchDetail(name: string): Promise<CardDetail> {
  return readJson<CardDetail>(`/api/workspace/detail?name=${encodeURIComponent(name)}`, 'Falha ao ler os detalhes da task')
}

export interface RepoDiff {
  name: string
  diff: string
  error?: string
}

export async function fetchDiff(name: string): Promise<RepoDiff[]> {
  const data = await readJson<{ repos: RepoDiff[] }>(`/api/workspace/diff?name=${encodeURIComponent(name)}`, 'Falha ao gerar o diff da task')
  return data.repos
}

export async function openFolder(name: string): Promise<void> {
  try {
    await readJson('/api/workspace/open', 'Falha ao abrir no editor configurado', {
      method: 'POST',
      body: { name },
    })
  } catch (error) {
    setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function openPrs(name: string, env: 'staging' | 'master', project?: string): Promise<void> {
  try {
    await readJson('/api/workspace/prs/open', 'Falha ao abrir os PRs', {
      method: 'POST',
      body: { name, env, project },
    })
  } catch (error) {
    setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function openTerminal(name: string): Promise<void> {
  try {
    await readJson('/api/workspace/terminal', 'Falha ao abrir o terminal', {
      method: 'POST',
      body: { name },
    })
  } catch (error) {
    setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function resetAutomaticStage(name: string, stage: string): Promise<void> {
  await readJson('/api/workspace/stage/reset', 'Falha ao interromper e limpar a etapa', {
    method: 'POST',
    body: { name, stage },
  })
  await refresh()
}

export async function startDevEnv(name: string, frontend?: string): Promise<string[] | null> {
  try {
    const data = await readJson<{ needsFrontend?: string[] }>('/api/workspace/dev-env', 'Falha ao iniciar o ambiente dev', {
      method: 'POST',
      body: { name, frontend },
    })
    if (data.needsFrontend) return data.needsFrontend
    await refresh()
  } catch (error) {
    setState({ error: error instanceof Error ? error.message : String(error) })
  }
  return null
}

export async function stopDevEnv(name: string): Promise<void> {
  try {
    await readJson('/api/workspace/dev-env/stop', 'Falha ao parar o ambiente dev', {
      method: 'POST',
      body: { name },
    })
    await refresh()
  } catch (error) {
    setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function openDevEnv(name: string, repo: string): Promise<void> {
  try {
    await readJson('/api/workspace/dev-env/open', 'Falha ao abrir o ambiente dev', {
      method: 'POST',
      body: { name, repo },
    })
  } catch (error) {
    setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

export async function openDevEnvAgent(name: string): Promise<void> {
  try {
    await readJson('/api/workspace/dev-env/agent', 'Falha ao abrir o agente do ambiente', {
      method: 'POST',
      body: { name },
    })
  } catch (error) {
    setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

let timer: number | undefined

function subscribe(notify: () => void): () => void {
  if (listeners.size === 0) {
    refresh()
    timer = window.setInterval(refresh, POLL_INTERVAL)
  }
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
    if (listeners.size === 0) window.clearInterval(timer)
  }
}

export function useCards(): CardsState {
  return useSyncExternalStore(subscribe, () => state)
}

export interface ChatHistory {
  sessionId: string | null
  entries: ChatEntry[]
  settings?: ChatAgentSettings | null
}

export async function fetchChat(name: string): Promise<ChatHistory> {
  return readJson<ChatHistory>(`/api/chat?name=${encodeURIComponent(name)}`, 'Falha ao ler o chat da task')
}

export async function abortChat(name: string): Promise<void> {
  await apiClient().request('/api/chat/abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function sendChat(
  name: string,
  text: string,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  try {
    await apiClient().sse('/api/chat/send', {
      method: 'POST',
      body: JSON.stringify({ name, text }),
      headers: { 'Content-Type': 'application/json' },
      onEvent: (event) => onEvent(event as ChatEvent),
    })
  } catch (error) {
    if (error instanceof ApiError && error.message === `Request failed (HTTP ${error.status})`) {
      throw new Error(`Falha ao enviar a mensagem (HTTP ${error.status})`)
    }
    throw error
  }
}
