import { mkdtempSync, readFileSync, statSync } from 'node:fs'
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

test('keeps Laya credentials private and honors environment precedence and explicit removal', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-laya-settings-'))
  const config = loadMegaBrainConfig({ homeDir: home, env: { LAYA_API_KEY: 'environment-secret' } })
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
    layaEnabled: true,
    layaBaseUrl: 'http://192.168.0.66:3000',
    layaApiKey: 'saved-secret',
  })
  expect(saved).toMatchObject({
    layaEnabled: true,
    layaConfigured: true,
    layaCredentialSource: 'environment',
  })
  expect(JSON.stringify(saved)).not.toContain('secret')
  expect(config.laya).toMatchObject({
    enabled: true,
    savedKey: 'saved-secret',
    environmentKey: 'environment-secret',
    savedBaseUrl: 'http://192.168.0.66:3000',
  })
  expect(statSync(config.preferences.settingsFile).mode & 0o777).toBe(0o600)
  const persisted = readFileSync(config.preferences.settingsFile, 'utf8')
  expect(persisted).toContain('saved-secret')
  expect(persisted).not.toContain('environment-secret')
  writeGeneralSettings(config, base)
  expect(config.laya).toMatchObject({ enabled: true, savedKey: 'saved-secret' })
  writeGeneralSettings(config, { ...base, layaRemoveSavedKey: true })
  expect(config.laya.savedKey).toBeUndefined()
  expect(readGeneralSettings(config).layaCredentialSource).toBe('environment')
  expect(readFileSync(config.preferences.settingsFile, 'utf8')).not.toContain('saved-secret')
})

test('validates the gateway origin, honors LAYA_BASE_URL and never exposes URL credentials', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-laya-url-'))
  const config = loadMegaBrainConfig({
    homeDir: home,
    env: { LAYA_API_KEY: 'env-key', LAYA_BASE_URL: 'http://gateway.local:3000' },
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
  expect(() => writeGeneralSettings(config, { ...base, layaBaseUrl: 'http://user:pass@192.168.0.66:3000' })).toThrow(
    'origem HTTP(S)',
  )
  expect(() => writeGeneralSettings(config, { ...base, layaBaseUrl: 'http://192.168.0.66:3000/v1/systemone' })).toThrow(
    'origem HTTP(S)',
  )
  const saved = writeGeneralSettings(config, { ...base, layaEnabled: true, layaBaseUrl: 'http://192.168.0.66:3000/' })
  expect(saved).toMatchObject({
    layaBaseUrl: 'http://192.168.0.66:3000',
    layaActiveBaseUrl: 'http://gateway.local:3000',
    layaUrlSource: 'environment',
    layaConfigured: true,
  })
  expect(readFileSync(config.preferences.settingsFile, 'utf8')).not.toContain('gateway.local')
  config.laya.environmentBaseUrl = 'http://user:pass@gateway.local:3000'
  const publicSettings = readGeneralSettings(config)
  expect(publicSettings.layaActiveBaseUrl).toBe('')
  expect(publicSettings.layaConfigured).toBe(false)
  expect(JSON.stringify(publicSettings)).not.toContain('pass')
})
