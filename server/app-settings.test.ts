import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { loadMegaBrainConfig } from './config'
import { editorExecutable, readGeneralSettings, writeGeneralSettings } from './app-settings'

test('persists global preferences outside the workspace and reloads them', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-settings-'))
  const config = loadMegaBrainConfig({ homeDir: home, env: { WORKSPACE_DIR: join(home, 'old-workspace') } })
  expect(readGeneralSettings(config).onboardingCompleted).toBe(false)
  config.executables.cursor = '/bin/sh'
  expect(editorExecutable(config)).toBe('/bin/sh')

  const saved = writeGeneralSettings(config, {
    editor: 'custom',
    editorCommand: '/bin/sh',
    terminalCommand: ' iTerm2 ',
    workspaceDir: join(home, 'cards'),
    worktreesDir: join(home, 'trees'),
    llmProvider: 'chatgpt',
    jiraSite: 'https://example.atlassian.net',
    jiraEmail: 'person@example.test',
    jiraApiToken: 'secret-token',
    jiraConfigured: false,
    onboardingCompleted: true,
  })

  expect(saved).toMatchObject({
    editor: 'custom',
    terminalCommand: 'iTerm2',
    llmProvider: 'chatgpt',
    jiraSite: 'example',
    jiraEmail: 'person@example.test',
    jiraApiToken: '',
    jiraConfigured: true,
    onboardingCompleted: true,
  })
  expect(config.workspaceDir).toBe(join(home, 'cards'))
  expect(editorExecutable(config)).toBe('/bin/sh')
  expect(JSON.parse(readFileSync(config.preferences.settingsFile, 'utf8'))).toMatchObject({
    jiraSite: 'example',
    jiraEmail: 'person@example.test',
    jiraApiToken: 'secret-token',
  })

  const reloaded = loadMegaBrainConfig({ homeDir: home, env: {} })
  expect(readGeneralSettings(reloaded)).toEqual(saved)
  const legacyInput = { ...saved }
  delete legacyInput.terminalCommand
  expect(writeGeneralSettings(reloaded, legacyInput).terminalCommand).toBe('iTerm2')
  expect(writeGeneralSettings(reloaded, { ...saved, terminalCommand: '' }).terminalCommand).toBe('')
  expect(() => writeGeneralSettings(reloaded, { ...saved, terminalCommand: 'Terminal\ncommand' })).toThrow('sem quebras de linha')
})

test('rejects relative directories and incomplete custom editors', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-settings-invalid-'))
  const config = loadMegaBrainConfig({ homeDir: home, env: {} })
  expect(() =>
    writeGeneralSettings(config, {
      editor: 'custom',
      editorCommand: '',
      workspaceDir: 'relative',
      worktreesDir: join(home, 'trees'),
      llmProvider: 'claude',
      jiraSite: '',
      jiraEmail: '',
      jiraApiToken: '',
      jiraConfigured: false,
      onboardingCompleted: true,
    }),
  ).toThrow('executável do editor')
  expect(() =>
    writeGeneralSettings(config, {
      editor: 'cursor',
      editorCommand: '',
      workspaceDir: 'relative',
      worktreesDir: join(home, 'trees'),
      llmProvider: 'claude',
      jiraSite: '',
      jiraEmail: '',
      jiraApiToken: '',
      jiraConfigured: false,
      onboardingCompleted: true,
    }),
  ).toThrow('caminho absoluto')
})

test('keeps the Jira token out of responses, preserves it on blank input and supports disabling', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-jira-settings-'))
  const config = loadMegaBrainConfig({ homeDir: home, env: {} })
  const base = {
    editor: 'cursor' as const,
    editorCommand: '',
    workspaceDir: join(home, 'cards'),
    worktreesDir: join(home, 'trees'),
    llmProvider: 'claude' as const,
    onboardingCompleted: true,
  }

  const configured = writeGeneralSettings(config, {
    ...base,
    jiraSite: 'https://example.atlassian.net/',
    jiraEmail: 'person@example.test',
    jiraApiToken: 'secret-token',
    jiraConfigured: false,
  })
  expect(configured).toMatchObject({ jiraSite: 'example', jiraApiToken: '', jiraConfigured: true })
  expect(config.jira.token).toBe('secret-token')

  const preserved = writeGeneralSettings(config, { ...configured, jiraApiToken: '' })
  expect(preserved).toMatchObject({ jiraApiToken: '', jiraConfigured: true })
  expect(config.jira.token).toBe('secret-token')

  const disabled = writeGeneralSettings(config, { ...preserved, jiraSite: '', jiraEmail: '', jiraApiToken: '' })
  expect(disabled).toMatchObject({ jiraSite: '', jiraEmail: '', jiraApiToken: '', jiraConfigured: false })
  expect(config.jira).toEqual({ site: undefined, email: undefined, token: undefined })
})

test('keeps Jev credentials private and honors environment precedence and explicit removal', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-jev-settings-'))
  const config = loadMegaBrainConfig({ homeDir: home, env: { TYPESAFE_API_KEY: 'environment-secret' } })
  const base = {
    editor: 'cursor' as const,
    editorCommand: '',
    workspaceDir: join(home, 'cards'),
    worktreesDir: join(home, 'trees'),
    llmProvider: 'claude' as const,
    jiraSite: '',
    jiraEmail: '',
    jiraApiToken: '',
    onboardingCompleted: true,
  }
  const saved = writeGeneralSettings(config, {
    ...base,
    jevEnabled: true,
    jevBaseUrl: 'https://api.typesafe.ai',
    jevApiKey: 'saved-secret',
  })
  expect(saved).toMatchObject({
    jevEnabled: true,
    jevConfigured: true,
    jevCredentialSource: 'environment',
  })
  expect(JSON.stringify(saved)).not.toContain('secret')
  expect(config.jev).toMatchObject({
    enabled: true,
    savedKey: 'saved-secret',
    environmentKey: 'environment-secret',
    savedBaseUrl: 'https://api.typesafe.ai',
  })
  if (process.platform !== 'win32') expect(statSync(config.preferences.settingsFile).mode & 0o777).toBe(0o600)
  const persisted = readFileSync(config.preferences.settingsFile, 'utf8')
  expect(persisted).toContain('saved-secret')
  expect(persisted).not.toContain('environment-secret')
  expect(loadMegaBrainConfig({ homeDir: home, env: {} }).jev).toMatchObject({
    enabled: true,
    savedKey: 'saved-secret',
    savedBaseUrl: 'https://api.typesafe.ai',
  })
  writeGeneralSettings(config, base)
  expect(config.jev).toMatchObject({ enabled: true, savedKey: 'saved-secret' })
  writeGeneralSettings(config, { ...base, jevRemoveSavedKey: true })
  expect(config.jev.savedKey).toBeUndefined()
  expect(readGeneralSettings(config).jevCredentialSource).toBe('environment')
  expect(readFileSync(config.preferences.settingsFile, 'utf8')).not.toContain('saved-secret')
})

test('does not reuse Laya credentials or silently enable hosted triage during migration', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-jev-migration-'))
  const settingsFile = join(home, 'settings.json')
  writeFileSync(
    settingsFile,
    JSON.stringify({ layaEnabled: true, layaApiKey: 'old-secret', layaBaseUrl: 'http://lan:3000' }),
  )
  const config = loadMegaBrainConfig({
    homeDir: home,
    env: { MEGA_BRAIN_SETTINGS_FILE: settingsFile, LAYA_API_KEY: 'old-env-secret', LAYA_BASE_URL: 'http://lan:3000' },
  })
  expect(config.jev).toEqual({
    enabled: false,
    savedKey: undefined,
    environmentKey: undefined,
    savedBaseUrl: undefined,
    environmentBaseUrl: undefined,
  })
  expect(readGeneralSettings(config)).toMatchObject({
    jevEnabled: false,
    jevConfigured: false,
    jevActiveBaseUrl: 'https://api.typesafe.ai',
    jevUrlSource: 'default',
  })
})

test('validates the API origin, honors TYPESAFE_BASE_URL and never exposes URL credentials', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-jev-url-'))
  const config = loadMegaBrainConfig({
    homeDir: home,
    env: { TYPESAFE_API_KEY: 'env-key', TYPESAFE_BASE_URL: 'https://gateway.local' },
  })
  const base = {
    editor: 'cursor',
    editorCommand: '',
    workspaceDir: join(home, 'cards'),
    worktreesDir: join(home, 'trees'),
    llmProvider: 'claude',
    jiraSite: '',
    jiraEmail: '',
    jiraApiToken: '',
    onboardingCompleted: true,
  }
  expect(() => writeGeneralSettings(config, { ...base, jevBaseUrl: 'https://user:pass@api.typesafe.ai' })).toThrow(
    'origem HTTPS',
  )
  expect(() => writeGeneralSettings(config, { ...base, jevBaseUrl: 'https://api.typesafe.ai/v1/systemone' })).toThrow(
    'origem HTTPS',
  )
  expect(() => writeGeneralSettings(config, { ...base, jevBaseUrl: 'http://api.typesafe.ai' })).toThrow('origem HTTPS')
  const saved = writeGeneralSettings(config, { ...base, jevEnabled: true, jevBaseUrl: 'https://api.typesafe.ai/' })
  expect(saved).toMatchObject({
    jevBaseUrl: 'https://api.typesafe.ai',
    jevActiveBaseUrl: 'https://gateway.local',
    jevUrlSource: 'environment',
    jevConfigured: true,
  })
  expect(readFileSync(config.preferences.settingsFile, 'utf8')).not.toContain('gateway.local')
  config.jev.environmentBaseUrl = 'https://user:pass@gateway.local'
  const publicSettings = readGeneralSettings(config)
  expect(publicSettings.jevActiveBaseUrl).toBe('')
  expect(publicSettings.jevConfigured).toBe(false)
  expect(JSON.stringify(publicSettings)).not.toContain('pass')
  delete config.jev.environmentBaseUrl
  const defaults = writeGeneralSettings(config, { ...base, jevBaseUrl: '' })
  expect(defaults).toMatchObject({
    jevBaseUrl: '',
    jevActiveBaseUrl: 'https://api.typesafe.ai',
    jevUrlSource: 'default',
    jevConfigured: true,
  })
})
