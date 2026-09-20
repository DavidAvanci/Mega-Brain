export type AgentStatus = 'rodando' | 'aguardando' | 'concluido' | 'erro' | 'morto'

export interface AgentInfo {
  sessionId?: string
  stage?: string
  status: AgentStatus
  startedAt?: string
  activity?: string
  phase?: string
  error?: string
  progress?: { done: number; total: number }
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
  apps: DevEnvApp[]
}
