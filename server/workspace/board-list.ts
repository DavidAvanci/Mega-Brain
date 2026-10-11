import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readDevEnv } from '../modules/dev-environments/dev-env'
import { prStates } from '../platform/pr-status'
import type { ProcessRunner } from '../process'
import type { AgentInfo, AgentSession } from '../../shared/domain/agents'
import { countTasks, TASK_CHECKLIST_FILE, type TaskCounts } from '../../shared/domain/task-checklist'
import { readTaskChecklist } from '../../shared/storage/task-checklist'
import { readCard, type CardData } from './card-record'
import { AGENT_FILE } from './stage-agent'
import { canRetryStageWithOpus, readAgent, stageEndedDueToRateLimit } from './stage-agent-status'
import { stageFor, type Stage } from './stage-catalog'
import { advanceStage, isResolvedAgentError } from './stage-transition'
import { cardRepos } from './worktree-inspector'
import { deleteCard, expiredInProduction } from './worktree-lifecycle'

export type BoardStageStarter = (path: string, stage: Stage, card: CardData, model?: string) => void

function taskIdForSession(session: AgentSession): string | undefined {
  const namedTask = /·\s*([A-Za-z]+\d+|#\d+)\b/.exec(session.name ?? '')?.[1]
  if (namedTask) return namedTask
  const titledTask = /(?:Item|Cenário|Correção orientada por teste que falhou):\s*([A-Za-z]+\d+|#\d+)\b/i.exec(
    session.title,
  )?.[1]
  if (titledTask) return titledTask
  const worktreeTask = /[\\/]items[\\/]([^\\/]+)(?:[\\/]|$)/i.exec(session.cwd)?.[1]
  return worktreeTask?.replace(/^_(\d+)$/, '#$1')
}

/** Produces the board projection and performs its established stage housekeeping. */
export function listBoardCards(
  root: string,
  worktreesRoot: string,
  git: string | undefined,
  runner: ProcessRunner,
  startStage: BoardStageStarter,
  sessions: readonly AgentSession[] = [],
  isSmartDiffRunning: (path: string) => boolean = () => false,
  smartDiffActivity: (path: string) => AgentInfo | undefined = () => undefined,
) {
  mkdirSync(root, { recursive: true })
  const activeSessionsByCard = new Map<string, AgentSession[]>()
  for (const session of sessions) {
    if (!session.cardId || (session.status !== 'rodando' && session.status !== 'aguardando')) continue
    const group = activeSessionsByCard.get(session.cardId)
    if (group) group.push(session)
    else activeSessionsByCard.set(session.cardId, [session])
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .flatMap((entry) => {
      const path = join(root, entry.name)
      const diffActivity = smartDiffActivity(path)
      const card = readCard(path, entry.name)
      if (expiredInProduction(path, card)) {
        deleteCard(path, worktreesRoot, git, runner)
        return []
      }
      const stat = statSync(path)
      const repoNames = cardRepos(path).map((repo) => repo.name)
      let agent = readAgent(path)
      const stage = stageFor(card.status)
      if (
        isResolvedAgentError(
          card,
          agent,
          repoNames,
        )
      ) {
        unlinkSync(join(path, AGENT_FILE))
        agent = null
      }
      if (
        agent?.status === 'erro' &&
        stage &&
        agent.stage === stage.name &&
        stageEndedDueToRateLimit(path, stage) &&
        canRetryStageWithOpus(path, stage)
      ) {
        startStage(path, stage, card, 'opus')
        agent = readAgent(path)
      }
      const advanced = advanceStage(path, card, agent, startStage)
      if (advanced !== card) agent = readAgent(path)
      const activeSessions = agent?.status === 'pausado' ? [] : (activeSessionsByCard.get(entry.name) ?? [])
        .filter((session) => session.id !== diffActivity?.sessionId)
      const stageSession =
        agent?.status === 'rodando'
          ? activeSessions.find((session) => session.id === agent.sessionId || session.cwd === realpathSync(path))
          : undefined
      const agents: AgentInfo[] = agent
        ? [{
            ...agent,
            ...(stageSession
              ? { status: stageSession.status, provider: stageSession.provider, sessionControlId: stageSession.id }
              : {}),
          }]
        : []
      for (const session of activeSessions) {
        if (session === stageSession) continue
        const taskId = taskIdForSession(session)
        agents.push({
          execution: 'agent',
          status: session.status,
          provider: session.provider,
          sessionControlId: session.id,
          ...(taskId ? { taskId, phase: `Iniciando ${taskId}` } : {}),
          startedAt: session.startedAt,
          activity: session.narration,
        })
      }
      const prUrls = Object.values(advanced.prs?.staging ?? {}).concat(Object.values(advanced.prs?.master ?? {}))
      const taskCounts: Partial<Record<typeof TASK_CHECKLIST_FILE, TaskCounts>> = {}
      let checklistError: string | undefined
      try {
        const checklist = readTaskChecklist(path)
        if (checklist) taskCounts[TASK_CHECKLIST_FILE] = countTasks(checklist)
      } catch (error) {
        checklistError = error instanceof Error ? error.message : String(error)
      }
      const cardFile = join(path, 'card.json')
      const updatedAt = existsSync(cardFile)
        ? new Date(statSync(cardFile).mtimeMs).toISOString()
        : new Date(stat.mtimeMs).toISOString()
      return {
        name: entry.name,
        path,
        createdAt: new Date(stat.birthtimeMs || stat.mtimeMs).toISOString(),
        updatedAt,
        agents,
        lastStage: agent?.stage,
        smartDiffRunning: isSmartDiffRunning(path),
        ...(diffActivity ? { smartDiffActivity: diffActivity } : {}),
        taskCounts,
        ...(checklistError ? { checklistError } : {}),
        repoCount: repoNames.length,
        devEnv: readDevEnv(path),
        prStates: prUrls.length ? prStates(prUrls) : undefined,
        ...advanced,
      }
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}
