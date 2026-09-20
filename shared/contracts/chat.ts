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
