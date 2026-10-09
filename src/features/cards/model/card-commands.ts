import type { KnowledgeRef } from '../../../../shared/domain/knowledge'
import { useSyncExternalStore } from 'react'
import { reportDesktopApiFailure } from '../../../desktopConnection'
import type { Card, FlowLevel, Status } from '../../../../shared/domain/cards'
import {
  createWorkspaceCard,
  deleteWorkspaceCard,
  listWorkspace,
  updateWorkspaceCard,
  workspaceAction,
} from '../api/cards-api'
import { fetchJiraStatuses, fetchReadyJiraIssues, transitionJiraStatus } from '../integrations/jira'
import { toCards } from './card-mappers'
import { cardsState, cardsSubscriberCount, setCardsState, subscribeCards, type CardsState } from './cards-state'

const LEGACY_TITLES_KEY = 'mega-brain-titles'
const LEGACY_STATUSES_KEY = 'mega-brain-statuses'
const POLL_INTERVAL = 5000
const USER_ACTION_WINDOW_MS = 10_000
const AGENT_STATUSES: ReadonlySet<Status> = new Set([
  'planejando',
  'desenvolvendo',
  'auto-testing',
  'staging',
  'aguardando-deploy',
])
const userInitiatedStatusChanges = new Map<string, { status: Status; expiresAt: number }>()
const pendingMoves = new Map<string, Pick<Card, 'status' | 'agents'>>()
let refreshVersion = 0
let jiraStatuses: Record<string, string> = {}
let timer: number | undefined

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function migrateLegacy(folders: Awaited<ReturnType<typeof listWorkspace>>): Promise<boolean> {
  const titles: unknown = JSON.parse(localStorage.getItem(LEGACY_TITLES_KEY) ?? 'null')
  const statuses: unknown = JSON.parse(localStorage.getItem(LEGACY_STATUSES_KEY) ?? 'null')
  const titleValues = titles && typeof titles === 'object' ? (titles as Record<string, unknown>) : {}
  const statusValues = statuses && typeof statuses === 'object' ? (statuses as Record<string, unknown>) : {}
  if (!Object.keys(titleValues).length && !Object.keys(statusValues).length) return false
  await Promise.all(
    folders.map((folder) => {
      const title = titleValues[folder.name]
      const status = statusValues[folder.name]
      if (typeof title !== 'string' && typeof status !== 'string') return undefined
      return updateWorkspaceCard(folder.name, {
        ...(typeof title === 'string' ? { title } : {}),
        ...(typeof status === 'string' ? { status } : {}),
      }).catch(() => {})
    }),
  )
  localStorage.removeItem(LEGACY_TITLES_KEY)
  localStorage.removeItem(LEGACY_STATUSES_KEY)
  return true
}

export async function refresh(): Promise<void> {
  const version = ++refreshVersion
  try {
    const folders = await listWorkspace()
    if (version !== refreshVersion) return
    if (await migrateLegacy(folders)) return refresh()
    if (version !== refreshVersion) return
    const cards = toCards(folders, jiraStatuses).map((card) => {
      const pending = pendingMoves.get(card.id)
      return pending ? { ...card, ...pending } : card
    })
    setCardsState({ cards, error: null, loaded: true })
    const nextJiraStatuses = await fetchJiraStatuses(folders)
    if (version !== refreshVersion) return
    jiraStatuses = nextJiraStatuses
    // Jira only updates its labels; never reapply an older workspace snapshot.
    setCardsState({
      cards: cardsState().cards.map((card) => ({ ...card, jiraStatus: jiraStatuses[card.id.toUpperCase()] })),
    })
  } catch (error) {
    if (version !== refreshVersion) return
    reportDesktopApiFailure(error)
    setCardsState({ error: message(error), loaded: true })
  }
}

export async function createCard(
  title: string,
  description: string,
  flow: FlowLevel = 'dificil',
  knowledgeRefs: KnowledgeRef[] = [],
): Promise<void> {
  await createWorkspaceCard(title, description, flow, undefined, knowledgeRefs)
  await refresh()
}

export async function syncJiraCards(): Promise<number> {
  const issues = await fetchReadyJiraIssues()
  const existing = new Set(cardsState().cards.map((card) => card.id.toUpperCase()))
  const missing = issues.filter((issue) => !existing.has(issue.key.toUpperCase()))
  await Promise.all(missing.map((issue) => createWorkspaceCard(issue.summary, issue.description, 'dificil', issue.key)))
  await refresh()
  return missing.length
}

export async function deleteCard(name: string): Promise<void> {
  await deleteWorkspaceCard(name)
  await refresh()
}

export async function updateCardDescription(name: string, description: string): Promise<void> {
  await updateWorkspaceCard(name, { description }, 'Falha ao atualizar a descrição')
  await refresh()
}

export function moveCard(id: string, status: Status): void {
  ++refreshVersion
  userInitiatedStatusChanges.set(id, { status, expiresAt: Date.now() + USER_ACTION_WINDOW_MS })
  const cards = cardsState().cards.map((card) => {
    if (card.id !== id) return card
    const startingAgent = AGENT_STATUSES.has(status) && card.status !== status
    const external = (card.agents ?? []).filter((agent) => !agent.stage)
    return {
      ...card,
      status,
      agents: startingAgent ? [{ status: 'rodando' as const, phase: 'Iniciando agente' }, ...external] : card.agents,
    }
  })
  const moved = cards.find((card) => card.id === id)
  const pending = { status, agents: moved?.agents }
  pendingMoves.set(id, pending)
  setCardsState({ cards })
  const settle = () => {
    if (pendingMoves.get(id) !== pending) return
    pendingMoves.delete(id)
    ++refreshVersion
  }
  updateWorkspaceCard(id, { status }, 'Falha ao mover o card')
    .then(() => {
      settle()
      return transitionJiraStatus(id, status).then((next) => {
        if (next) jiraStatuses[id.toUpperCase()] = next
      })
    })
    .then(refresh)
    .catch(async (error) => {
      settle()
      await refresh()
      setCardsState({ error: message(error) })
    })
}

export function consumeUserInitiatedStatusChange(id: string, status: Status): boolean {
  const change = userInitiatedStatusChanges.get(id)
  if (!change) return false
  userInitiatedStatusChanges.delete(id)
  return change.status === status && change.expiresAt >= Date.now()
}

export function setCardFlow(id: string, flow: FlowLevel): void {
  setCardsState({ cards: cardsState().cards.map((card) => (card.id === id ? { ...card, flow } : card)) })
  updateWorkspaceCard(id, { flow }, 'Falha ao alterar o fluxo do card')
    .then(refresh)
    .catch((error) => setCardsState({ error: message(error) }))
}

async function action(
  path: string,
  fallback: string,
  body: Record<string, unknown>,
  refreshAfter = false,
): Promise<void> {
  try {
    await workspaceAction(path, fallback, body)
    if (refreshAfter) await refresh()
  } catch (error) {
    setCardsState({ error: message(error) })
  }
}

export const openFolder = (name: string) =>
  action('/api/workspace/open', 'Falha ao abrir no editor configurado', { name })
export const openPrs = (name: string, env: 'staging' | 'master', project?: string) =>
  action('/api/workspace/prs/open', 'Falha ao abrir os PRs', { name, env, project })
export const openTerminal = (name: string) => action('/api/workspace/terminal', 'Falha ao abrir o terminal', { name })
export const pauseCardAgents = (name: string, stage: string) =>
  action('/api/workspace/stage/pause', 'Falha ao pausar os agentes', { name, stage }, true)
export const resumeCardAgents = (name: string, stage: string) =>
  action('/api/workspace/stage/resume', 'Falha ao retomar os agentes', { name, stage }, true)
export const resetAutomaticStage = (name: string, stage: string) =>
  action('/api/workspace/stage/reset', 'Falha ao interromper e limpar a etapa', { name, stage }, true)
export const stopCardAgent = (id: string) =>
  action('/api/agents/stop', 'Falha ao interromper o agente', { id }, true)
export const clearLatestStage = (name: string, stage: string) =>
  action('/api/workspace/stage/clear', 'Falha ao limpar a etapa', { name, stage }, true)
export const stopDevEnv = (name: string) =>
  action('/api/workspace/dev-env/stop', 'Falha ao parar o ambiente dev', { name }, true)
export const openDevEnv = (name: string, repo: string) =>
  action('/api/workspace/dev-env/open', 'Falha ao abrir o ambiente dev', { name, repo })

function subscribe(notify: () => void): () => void {
  if (cardsSubscriberCount() === 0) {
    void refresh()
    timer = window.setInterval(refresh, POLL_INTERVAL)
  }
  const unsubscribe = subscribeCards(notify)
  return () => {
    unsubscribe()
    if (cardsSubscriberCount() === 0) window.clearInterval(timer)
  }
}

export function useCards(): CardsState {
  return useSyncExternalStore(subscribe, cardsState)
}
