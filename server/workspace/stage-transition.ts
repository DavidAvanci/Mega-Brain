import type { AgentInfo } from '../../shared/domain/agents'
import { readFlow } from './card-folder'
import { type CardData, writeCard } from './card-record'
import { runStageAgent } from './stage-agent'
import { FLOW_PROFILES, STAGES, stageFor, type Stage } from './stage-catalog'
import { discardStageSnapshot } from './stage-snapshot'

export type StageStarter = (path: string, stage: Stage, card: CardData) => void

export function advanceStage(
  path: string,
  card: CardData,
  agent: AgentInfo | null,
  start: StageStarter = runStageAgent,
): CardData {
  const stage = stageFor(card.status)
  const flow = readFlow(card.flow)
  const nextStatus = stage && FLOW_PROFILES[flow].next[stage.name]
  if (!stage || !nextStatus || agent?.status !== 'concluido' || (agent.stage ?? STAGES[0].name) !== stage.name)
    return card
  const next = { ...card, flow, status: nextStatus }
  discardStageSnapshot(path, stage.name)
  writeCard(path, next)
  const nextStage = stageFor(nextStatus)
  if (nextStage) start(path, nextStage, next)
  return next
}

function hasPrsForAllRepos(
  prs: CardData['prs'] | undefined,
  environment: 'staging' | 'master',
  repos: readonly string[],
): boolean {
  const links = prs?.[environment]
  return repos.length > 0 && repos.every((repo) => Boolean(links?.[repo]))
}

/** Ignores historical agent failures when the card has already advanced. */
export function isResolvedAgentError(card: CardData, agent: AgentInfo | null, repos: readonly string[] = []): boolean {
  if (agent?.status !== 'erro' || !agent.stage) return false
  const agentStage = STAGES.find((stage) => stage.name === agent.stage)
  if (!agentStage) return false
  if (card.status !== agentStage.status) return true
  if (agentStage.name === 'stage-task') return hasPrsForAllRepos(card.prs, 'staging', repos)
  if (agentStage.name === 'master-pr-task')
    return card.status === 'producao' || hasPrsForAllRepos(card.prs, 'master', repos)
  return false
}
