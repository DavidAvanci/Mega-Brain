export interface ChatEntry {
  role: 'user' | 'assistant'
  text?: string
  tool?: string
  output?: string
  source?: string
  queued?: boolean
}

export interface ChatAgentSettings {
  model: string
  effort: string
}

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: string }
  | { type: 'output'; text: string }
  | { type: 'settings'; settings: ChatAgentSettings }
  | { type: 'queued' }
  | { type: 'done'; error?: string }
import type { LlmProvider } from '../domain/settings'

export type ChatModelSelection = { provider: LlmProvider; model: string }
