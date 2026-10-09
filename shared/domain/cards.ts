import type { KnowledgeRef } from './knowledge'
import type { AgentInfo, DevEnvInfo } from './agents'

export const STATUSES = [
  'a-fazer',
  'planejando',
  'revisao-de-plano',
  'desenvolvendo',
  'code-review',
  'staging',
  'aguardando-deploy',
  'producao',
] as const

export type Status = (typeof STATUSES)[number]

export const FLOW_LEVELS = ['simples', 'medio', 'dificil'] as const
export type FlowLevel = (typeof FLOW_LEVELS)[number]

export const FLOW_LABELS: Record<FlowLevel, string> = {
  simples: 'Simples',
  medio: 'Médio',
  dificil: 'Difícil',
}

export const FLOW_DESCRIPTIONS: Record<FlowLevel, string> = {
  simples: 'Gera apenas a checklist de desenvolvimento e pula a revisão de plano.',
  medio: 'Gera plano e checklist de desenvolvimento, mantendo a revisão de plano.',
  dificil: 'Fluxo completo, com plano, checklist de desenvolvimento e revisão de plano.',
}

export const STATUS_LABELS: Record<Status, string> = {
  'a-fazer': 'A fazer',
  planejando: 'Planejando',
  'revisao-de-plano': 'Revisão de plano',
  desenvolvendo: 'Desenvolvendo',
  'code-review': 'Code Review',
  staging: 'Staging',
  'aguardando-deploy': 'Aguardando deploy',
  producao: 'Produção',
}

export interface PrLinks {
  staging?: Record<string, string>
  master?: Record<string, string>
}

export type PrState = 'open' | 'merged' | 'closed'

export interface CardTaskCounts {
  total: number
  done: number
  skipped: number
  failed: number
}

export interface Card {
  knowledgeRefs?: KnowledgeRef[]
  id: string
  title: string
  description: string
  folder: string
  createdAt: string
  updatedAt?: string
  status: Status
  flow: FlowLevel
  lastStage?: string
  jiraStatus?: string
  agents?: AgentInfo[]
  smartDiffRunning?: boolean
  devEnv?: DevEnvInfo
  prs?: PrLinks
  prStates?: Record<string, PrState>
  taskCounts?: Partial<Record<'TASK-CHECKLIST.md', CardTaskCounts>>
  repoCount?: number
}
