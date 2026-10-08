export type Effort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'

export interface ModelStageSettings {
  model: string
  effort: Effort
}

export type BoardSettings = Record<'task-planning' | 'run-task-checklist' | 'run-test-checklist', ModelStageSettings>

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
  workspaceDir: string
  worktreesDir: string
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
  testItem: string
  testEnvironment: string
  smartDiffReview: string
}

export { DEFAULT_PROMPTS } from './prompt-defaults'
