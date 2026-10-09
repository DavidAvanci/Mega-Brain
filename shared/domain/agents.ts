import type { IslandVisualState } from './activity-island'
import type { DevEnvStartOptions } from './dev-environments'

export type AgentStatus = 'rodando' | 'aguardando' | 'concluido' | 'erro' | 'morto' | 'pausado'

export interface AgentInfo {
  provider?: AgentProvider
  sessionId?: string
  sessionControlId?: string
  taskId?: string
  stage?: string
  status: AgentStatus
  startedAt?: string
  pausedAt?: string
  resumable?: boolean
  activity?: string
  phase?: string
  error?: string
  progress?: { done: number; total: number }
  visualState?: IslandVisualState
  question?: string
  codexProfileId?: string
  codexProfileName?: string
  codexProfileColor?: string
}

export type AgentProvider = 'claude' | 'codex'

export interface CardAgentUsage {
  durationMs: number
  costUsd: number
  runs: number
  unpricedRuns: number
}

export interface CardAgentUsageEntry {
  id: string
  label?: string
  provider?: AgentProvider
  model?: string
  startedAt: string
  finishedAt?: string
  durationMs: number
  costUsd?: number
}

export interface AgentSession {
  id: string
  provider: AgentProvider
  model?: string
  effort?: string
  status: AgentStatus
  cardId?: string
  cwd: string
  title: string
  name?: string
  startedAt: string
  updatedAt: string
  activity?: string
  visualState?: IslandVisualState
  question?: string
  codexProfileId?: string
  codexProfileName?: string
  codexProfileColor?: string
  pid?: number
}

export interface AgentSessionsResponse {
  sessions: AgentSession[]
  scannedAt: string
}

export type DevEnvAppStatus = 'aguardando' | 'instalando' | 'subindo' | 'rodando' | 'erro' | 'parado'

export interface DevEnvApp {
  repo: string
  kind: 'backend' | 'frontend'
  source: 'worktree' | 'master'
  apiUrl?: string
  clubeApiUrl?: string
  port?: number
  url?: string
  pid?: number
  status: DevEnvAppStatus
  note?: string
}

export interface DevEnvInfo {
  status: 'subindo' | 'rodando' | 'erro' | 'parado'
  ownerPid?: number
  startedAt?: string
  phase?: string
  error?: string
  warnings?: string[]
  configuration?: DevEnvStartOptions
  apps: DevEnvApp[]
}
