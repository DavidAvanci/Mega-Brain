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

export interface UsageWindow {
  utilization: number
  resetsAt: string | null
}

export interface ClaudeUsage {
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  fable: UsageWindow | null
}

export interface ChatEntry {
  role: 'user' | 'assistant'
  text?: string
  tool?: string
}

export interface ChatAgentSettings {
  model: string
  effort: string
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: string }
  | { type: 'settings'; settings: ChatAgentSettings }
  | { type: 'done'; error?: string }

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

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ModelStageSettings {
  model: string
  effort: Effort
}

export type BoardSettings = Record<'task-planning' | 'run-task-checklist' | 'run-test-checklist', ModelStageSettings>

export type EditorPreference = 'cursor' | 'vscode' | 'windsurf' | 'zed' | 'sublime' | 'intellij' | 'webstorm' | 'pycharm' | 'custom'
export type LlmProvider = 'claude' | 'chatgpt'

export interface DetectedEditor {
  id: Exclude<EditorPreference, 'custom'>
  label: string
  command: string
  source: 'linux' | 'windows'
}

export interface EditorDiscovery {
  editors: DetectedEditor[]
  scope: string
}

export interface GeneralSettings {
  editor: EditorPreference
  editorCommand: string
  workspaceDir: string
  worktreesDir: string
  llmProvider: LlmProvider
  jiraSite: string
  jiraEmail: string
  jiraApiToken: string
  jiraConfigured: boolean
  onboardingCompleted: boolean
}

export interface MegaBrainSettings {
  general: GeneralSettings
  stages: BoardSettings
}
