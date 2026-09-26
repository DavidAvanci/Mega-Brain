export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

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
  layaEnabled: boolean
  layaBaseUrl: string
  layaActiveBaseUrl: string
  layaUrlSource: 'environment' | 'saved' | 'none'
  layaConfigured: boolean
  layaCredentialSource: 'environment' | 'saved' | 'none'
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
  layaApiKey?: string
  layaRemoveSavedKey?: boolean
}

export interface MegaBrainSettings {
  general: GeneralSettings
  stages: BoardSettings
}
