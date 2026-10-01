import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { GeneralSettings, GeneralSettingsInput } from '../shared/domain/settings'
import type { MegaBrainConfig } from './config'
import { resolveOptionalExecutable } from './platform'
import { detectEditors } from './editor-detection'
import { DEFAULT_JEV_BASE_URL, normalizeJevBaseUrl } from './integrations/jev/url'

const EDITORS = new Set(['cursor', 'vscode', 'windsurf', 'zed', 'sublime', 'intellij', 'webstorm', 'pycharm', 'custom'])
const PROVIDERS = new Set(['claude', 'chatgpt'])

function safeJevBaseUrl(value: string | undefined): string {
  if (!value) return ''
  try {
    return normalizeJevBaseUrl(value)
  } catch {
    return ''
  }
}

export function readGeneralSettings(config: MegaBrainConfig): GeneralSettings {
  const jiraConfigured = Boolean(config.jira.site && config.jira.email && config.jira.token)
  const activeBaseUrl = safeJevBaseUrl(config.jev.environmentBaseUrl || config.jev.savedBaseUrl || DEFAULT_JEV_BASE_URL)
  return {
    jevEnabled: config.jev.enabled,
    jevBaseUrl: safeJevBaseUrl(config.jev.savedBaseUrl),
    jevActiveBaseUrl: activeBaseUrl,
    jevUrlSource: config.jev.environmentBaseUrl ? 'environment' : config.jev.savedBaseUrl ? 'saved' : 'default',
    jevConfigured: Boolean((config.jev.environmentKey || config.jev.savedKey) && activeBaseUrl),
    jevCredentialSource: config.jev.environmentKey ? 'environment' : config.jev.savedKey ? 'saved' : 'none',
    editor: config.preferences.editor,
    editorCommand: config.preferences.editorCommand,
    workspaceDir: resolve(config.workspaceDir),
    worktreesDir: resolve(config.worktreesDir),
    llmProvider: config.preferences.llmProvider,
    jiraSite: config.jira.site ?? '',
    jiraEmail: config.jira.email ?? '',
    jiraApiToken: '',
    jiraConfigured,
    onboardingCompleted: config.preferences.onboardingCompleted,
  }
}

function requiredAbsolutePath(value: unknown, label: string): string {
  const path = typeof value === 'string' ? value.trim() : ''
  if (!path || !isAbsolute(path)) throw new Error(`${label} deve ser um caminho absoluto`)
  return resolve(path)
}

export function writeGeneralSettings(config: MegaBrainConfig, value: unknown): GeneralSettings {
  if (!value || typeof value !== 'object') throw new Error('Configurações gerais inválidas')
  const input = value as Partial<GeneralSettingsInput>
  if (!EDITORS.has(String(input.editor))) throw new Error('Editor inválido')
  if (!PROVIDERS.has(String(input.llmProvider))) throw new Error('Provedor LLM inválido')

  const editor = input.editor as GeneralSettings['editor']
  const editorCommand = typeof input.editorCommand === 'string' ? input.editorCommand.trim() : ''
  if (editor === 'custom' && !editorCommand) throw new Error('Informe o executável do editor personalizado')

  const jiraSite =
    typeof input.jiraSite === 'string'
      ? input.jiraSite
          .trim()
          .replace(/^https?:\/\//, '')
          .replace(/\.atlassian\.net\/?$/, '')
      : ''
  const jiraEmail = typeof input.jiraEmail === 'string' ? input.jiraEmail.trim() : ''
  const newJiraToken = typeof input.jiraApiToken === 'string' ? input.jiraApiToken.trim() : ''
  const jiraApiToken = jiraSite || jiraEmail ? newJiraToken || config.jira.token || '' : ''
  if (jiraSite || jiraEmail || jiraApiToken) {
    if (!jiraSite || !jiraEmail || !jiraApiToken) throw new Error('Preencha site, e-mail e token da API do Jira')
  }

  const jevApiKey = typeof input.jevApiKey === 'string' ? input.jevApiKey.trim() : ''
  const savedJevKey = input.jevRemoveSavedKey === true ? undefined : jevApiKey || config.jev.savedKey
  const jevEnabled = input.jevEnabled === undefined ? config.jev.enabled : input.jevEnabled === true
  const savedBaseUrl =
    input.jevBaseUrl === undefined
      ? safeJevBaseUrl(config.jev.savedBaseUrl) || undefined
      : typeof input.jevBaseUrl === 'string' && input.jevBaseUrl.trim()
        ? normalizeJevBaseUrl(input.jevBaseUrl)
        : undefined
  const activeBaseUrl = safeJevBaseUrl(config.jev.environmentBaseUrl || savedBaseUrl || DEFAULT_JEV_BASE_URL)

  const settings: GeneralSettings = {
    jevEnabled,
    jevBaseUrl: savedBaseUrl ?? '',
    jevActiveBaseUrl: activeBaseUrl,
    jevUrlSource: config.jev.environmentBaseUrl ? 'environment' : savedBaseUrl ? 'saved' : 'default',
    jevConfigured: Boolean((config.jev.environmentKey || savedJevKey) && activeBaseUrl),
    jevCredentialSource: config.jev.environmentKey ? 'environment' : savedJevKey ? 'saved' : 'none',
    editor,
    editorCommand,
    workspaceDir: requiredAbsolutePath(input.workspaceDir, 'Workspace'),
    worktreesDir: requiredAbsolutePath(input.worktreesDir, 'Diretório de worktrees'),
    llmProvider: input.llmProvider as GeneralSettings['llmProvider'],
    jiraSite,
    jiraEmail,
    jiraApiToken,
    jiraConfigured: Boolean(jiraSite && jiraEmail && jiraApiToken),
    onboardingCompleted: input.onboardingCompleted === true,
  }

  mkdirSync(settings.workspaceDir, { recursive: true })
  mkdirSync(settings.worktreesDir, { recursive: true })
  const file = config.preferences.settingsFile
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify({ ...settings, jevApiKey: savedJevKey ?? undefined, jevConfigured: undefined, jevCredentialSource: undefined, jevRemoveSavedKey: undefined, jevActiveBaseUrl: undefined, jevUrlSource: undefined, jiraConfigured: undefined }, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' },
    )
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
  config.jev.enabled = jevEnabled
  config.jev.savedKey = savedJevKey
  config.jev.savedBaseUrl = savedBaseUrl

  config.workspaceDir = settings.workspaceDir
  config.worktreesDir = settings.worktreesDir
  config.preferences.editor = settings.editor
  config.preferences.editorCommand = settings.editorCommand
  config.preferences.llmProvider = settings.llmProvider
  config.preferences.onboardingCompleted = settings.onboardingCompleted
  config.jira.site = jiraSite || undefined
  config.jira.email = jiraEmail || undefined
  config.jira.token = jiraApiToken || undefined
  return readGeneralSettings(config)
}

export function editorExecutable(config: MegaBrainConfig): string {
  if (config.preferences.editor === 'custom') {
    return resolveOptionalExecutable({ configured: config.preferences.editorCommand, candidates: [], label: 'Editor' })
  }
  const detected = detectEditors(config).editors.find((editor) => editor.id === config.preferences.editor)
  if (detected) return detected.command
  throw new Error('O editor configurado não está mais disponível. Escolha outro em Configurações.')
}
