import { useSyncExternalStore } from 'react'
import { reportDesktopApiFailure } from '../../../desktopConnection'
import type { FlowLevel, Status } from '../../../../shared/domain/cards'
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
  try {
    const folders = await listWorkspace()
    if (await migrateLegacy(folders)) return refresh()
    setCardsState({ cards: toCards(folders, jiraStatuses), error: null, loaded: true })
    jiraStatuses = await fetchJiraStatuses(folders)
    setCardsState({ cards: toCards(folders, jiraStatuses) })
  } catch (error) {
    reportDesktopApiFailure(error)
    setCardsState({ error: message(error), loaded: true })
  }
}

export async function createCard(title: string, description: string, flow: FlowLevel = 'dificil'): Promise<void> {
  await createWorkspaceCard(title, description, flow)
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

export function moveCard(id: string, status: Status): void {
  userInitiatedStatusChanges.set(id, { status, expiresAt: Date.now() + USER_ACTION_WINDOW_MS })
  setCardsState({
    cards: cardsState().cards.map((card) => {
      if (card.id !== id) return card
      const startingAgent = AGENT_STATUSES.has(status) && card.status !== status
      const external = (card.agents ?? []).filter((agent) => !agent.stage)
      return {
        ...card,
        status,
        agents: startingAgent ? [{ status: 'rodando' as const, phase: 'Iniciando agente' }, ...external] : card.agents,
      }
    }),
  })
  updateWorkspaceCard(id, { status }, 'Falha ao mover o card')
    .then(() =>
      transitionJiraStatus(id, status).then((next) => {
        if (next) jiraStatuses[id.toUpperCase()] = next
      }),
    )
    .then(refresh)
    .catch((error) => setCardsState({ error: message(error) }))
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
export const resetAutomaticStage = (name: string, stage: string) =>
  action('/api/workspace/stage/reset', 'Falha ao interromper e limpar a etapa', { name, stage }, true)
export const startDevEnv = async (name: string, frontend?: string): Promise<string[] | null> => {
  try {
    const result = (await workspaceAction('/api/workspace/dev-env', 'Falha ao iniciar o ambiente dev', {
      name,
      frontend,
    })) as { needsFrontend?: string[] }
    if (result.needsFrontend) return result.needsFrontend
    await refresh()
  } catch (error) {
    setCardsState({ error: message(error) })
  }
  return null
}
export const stopDevEnv = (name: string) =>
  action('/api/workspace/dev-env/stop', 'Falha ao parar o ambiente dev', { name }, true)
export const openDevEnv = (name: string, repo: string) =>
  action('/api/workspace/dev-env/open', 'Falha ao abrir o ambiente dev', { name, repo })
export const openDevEnvAgent = (name: string) =>
  action('/api/workspace/dev-env/agent', 'Falha ao abrir o agente do ambiente', { name })

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
