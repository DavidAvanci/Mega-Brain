import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readDevEnv } from '../modules/dev-environments/dev-env'
import { prStates } from '../platform/pr-status'
import type { ProcessRunner } from '../process'
import type { AgentInfo, AgentSession } from '../../shared/domain/agents'
import { readCard, type CardData } from './card-record'
import { AGENT_FILE } from './stage-agent'
import { canRetryStageWithOpus, readAgent, stageEndedDueToRateLimit } from './stage-agent-status'
import { stageFor, type Stage } from './stage-catalog'
import { advanceStage, isResolvedAgentError } from './stage-transition'
import { cardRepos } from './worktree-inspector'
import { deleteCard, expiredInProduction } from './worktree-lifecycle'

export type BoardStageStarter = (path: string, stage: Stage, card: CardData, model?: string) => void

/** Produces the board projection and performs its established stage housekeeping. */
export function listBoardCards(
  root: string,
  worktreesRoot: string,
  git: string | undefined,
  runner: ProcessRunner,
  startStage: BoardStageStarter,
  sessions: readonly AgentSession[] = [],
  isSmartDiffRunning: (path: string) => boolean = () => false,
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
      const card = readCard(path, entry.name)
      if (expiredInProduction(path, card)) {
        deleteCard(path, worktreesRoot, git, runner)
        return []
      }
      const stat = statSync(path)
      let agent = readAgent(path)
      const stage = stageFor(card.status)
      if (
        isResolvedAgentError(
          card,
          agent,
          cardRepos(path).map((repo) => repo.name),
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
      const activeSessions = activeSessionsByCard.get(entry.name) ?? []
      const stageSession =
        agent?.status === 'rodando'
          ? activeSessions.find((session) => session.id === agent.sessionId || session.cwd === realpathSync(path))
          : undefined
      const agents: AgentInfo[] = agent
        ? [{ ...agent, ...(stageSession ? { status: stageSession.status, provider: stageSession.provider } : {}) }]
        : []
      for (const session of activeSessions) {
        if (session === stageSession) continue
        agents.push({
          status: session.status,
          provider: session.provider,
          startedAt: session.startedAt,
          activity: session.activity,
        })
      }
      const prUrls = Object.values(advanced.prs?.staging ?? {}).concat(Object.values(advanced.prs?.master ?? {}))
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
        smartDiffRunning: isSmartDiffRunning(path),
        devEnv: readDevEnv(path),
        prStates: prUrls.length ? prStates(prUrls) : undefined,
        ...advanced,
      }
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}
