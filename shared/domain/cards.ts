import type { AgentInfo, DevEnvInfo } from './agents'

export const STATUSES = [
  'a-fazer',
  'planejando',
  'revisao-de-plano',
  'desenvolvendo',
  'auto-testing',
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
  simples: 'Gera apenas a checklist de desenvolvimento e pula revisão de plano e testes automáticos.',
  medio: 'Gera plano e checklist de desenvolvimento, mantém a revisão de plano e não gera testes.',
  dificil: 'Fluxo completo atual, com plano, checklist de desenvolvimento e testes automáticos.',
}

export const STATUS_LABELS: Record<Status, string> = {
  'a-fazer': 'A fazer',
  planejando: 'Planejando',
  'revisao-de-plano': 'Revisão de plano',
  desenvolvendo: 'Desenvolvendo',
  'auto-testing': 'Auto Testing',
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

export interface Card {
  id: string
  title: string
  description: string
  folder: string
  createdAt: string
  updatedAt?: string
  status: Status
  flow: FlowLevel
  jiraStatus?: string
  agents?: AgentInfo[]
  devEnv?: DevEnvInfo
  prs?: PrLinks
  prStates?: Record<string, PrState>
}
