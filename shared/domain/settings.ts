export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

export interface ModelStageSettings {
  model: string
  effort: Effort
  fastMode?: boolean
}

export type BoardSettings = Record<'task-planning' | 'run-task-checklist', ModelStageSettings>

export type EditorPreference =
  'cursor' | 'vscode' | 'windsurf' | 'zed' | 'sublime' | 'intellij' | 'webstorm' | 'pycharm' | 'custom'
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
  jevEnabled: boolean
  jevBaseUrl: string
  jevActiveBaseUrl: string
  jevUrlSource: 'environment' | 'saved' | 'default'
  jevConfigured: boolean
  jevCredentialSource: 'environment' | 'saved' | 'none'
  editor: EditorPreference
  editorCommand: string
  /** Empty or omitted selects the terminal for the backend's operating system. */
  terminalCommand?: string
  /** Empty or omitted runs the agent directly; otherwise loads a POSIX login shell. */
  shellCommand?: string
  workspaceDir: string
  worktreesDir: string
  /** Stored beside the cards directory; omitted by older backends. */
  readonly knowledgeDir?: string
  llmProvider: LlmProvider
  jiraSite: string
  jiraEmail: string
  jiraApiToken: string
  jiraConfigured: boolean
  onboardingCompleted: boolean
}

export interface GeneralSettingsInput extends GeneralSettings {
  jevApiKey?: string
  jevRemoveSavedKey?: boolean
}

export interface MegaBrainSettings {
  general: GeneralSettings
  stages: BoardSettings
  prompts: PromptSettings
}

export interface PromptSettings {
  taskPlanning: string
  taskItem: string
  testEnvironment: string
  smartDiffReview: string
}

export { DEFAULT_PROMPTS } from './prompt-defaults'
