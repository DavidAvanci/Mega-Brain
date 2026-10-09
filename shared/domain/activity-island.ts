export interface IslandDisplaySettings {
  enabled: boolean
  style: 'clean' | 'detailed'
  fontSize: number
  completionHeight: number
  maxHeight: number
  maxWidth: number
  taskSounds: boolean
  monitorId: string
  petAppearance: 'auto' | 'codex' | 'claude'
  petSize: number
  animations: boolean
  animationSpeed: number
  runningColor: string
  thinkingColor: string
  waitingColor: string
  successColor: string
  errorColor: string
  autoExpandOnWaiting: boolean
  compactOthers: boolean
  showActivity: boolean
  cornerRadius: number
  compactWidth: number
  hiddenCodexProfileIds: string[]
  showProfileBadge: boolean
}

export const DEFAULT_ISLAND_DISPLAY: IslandDisplaySettings = {
  enabled: true,
  style: 'detailed',
  fontSize: 11,
  completionHeight: 54,
  maxHeight: 270,
  maxWidth: 660,
  taskSounds: true,
  monitorId: '',
  petAppearance: 'auto',
  petSize: 24,
  animations: true,
  animationSpeed: 100,
  runningColor: '#64B8FF',
  thinkingColor: '#B69CFF',
  waitingColor: '#FFB454',
  successColor: '#73D99A',
  errorColor: '#FF7373',
  autoExpandOnWaiting: true,
  compactOthers: true,
  showActivity: true,
  cornerRadius: 30,
  compactWidth: 480,
  hiddenCodexProfileIds: [],
  showProfileBadge: true,
}

export type IslandVisualState =
  'working' | 'thinking' | 'reading' | 'editing' | 'testing' | 'waiting' | 'complete' | 'error' | 'idle'

export interface IslandActivity {
  taskId: string
  cardId?: string
  threadId?: string
  title: string
  project?: string
  agent: 'claude' | 'codex'
  status: 'running' | 'waiting' | 'complete' | 'error' | 'stopped'
  activity?: string
  stage?: string
  checked: number
  total: number
  events: { id: string; kind: 'tool'; title: string; status: string }[]
  visualState?: IslandVisualState
  question?: string
  replyMode?: 'card' | 'external'
  sessionId?: string
  codexProfileId?: string
  codexProfileName?: string
  codexProfileColor?: string
}

export interface IslandIntent {
  id: string
  target: 'main' | 'settings' | 'task' | 'agents'
  taskId?: string
}
