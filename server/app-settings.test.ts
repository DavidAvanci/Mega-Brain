import { mkdtempSync, readFileSync } from 'node:fs'
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

  expect(saved).toMatchObject({ editor: 'custom', llmProvider: 'chatgpt', jiraSite: 'example', jiraEmail: 'person@example.test', jiraApiToken: '', jiraConfigured: true, onboardingCompleted: true })
  expect(config.workspaceDir).toBe(join(home, 'cards'))
  expect(editorExecutable(config)).toBe('/bin/sh')
  expect(JSON.parse(readFileSync(config.preferences.settingsFile, 'utf8'))).toMatchObject({ jiraSite: 'example', jiraEmail: 'person@example.test', jiraApiToken: 'secret-token' })

  const reloaded = loadMegaBrainConfig({ homeDir: home, env: {} })
  expect(readGeneralSettings(reloaded)).toEqual(saved)
})

test('rejects relative directories and incomplete custom editors', () => {
  const home = mkdtempSync(join(tmpdir(), 'mega-brain-settings-invalid-'))
  const config = loadMegaBrainConfig({ homeDir: home, env: {} })
  expect(() => writeGeneralSettings(config, {
    editor: 'custom', editorCommand: '', workspaceDir: 'relative', worktreesDir: join(home, 'trees'),
    llmProvider: 'claude', jiraSite: '', jiraEmail: '', jiraApiToken: '', jiraConfigured: false, onboardingCompleted: true,
  })).toThrow('executável do editor')
  expect(() => writeGeneralSettings(config, {
    editor: 'cursor', editorCommand: '', workspaceDir: 'relative', worktreesDir: join(home, 'trees'),
    llmProvider: 'claude', jiraSite: '', jiraEmail: '', jiraApiToken: '', jiraConfigured: false, onboardingCompleted: true,
  })).toThrow('caminho absoluto')
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
