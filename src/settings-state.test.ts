import { expect, test } from 'vitest'
import { DEFAULT_PROMPTS, type MegaBrainSettings } from '../shared/domain/settings'
import { withGeneralSettings, withStageSetting } from './settings-state'

const settings: MegaBrainSettings = {
  general: {
    jevEnabled: false,
    jevBaseUrl: '',
    jevActiveBaseUrl: '',
    jevUrlSource: 'default',
    jevConfigured: false,
    jevCredentialSource: 'none',
    llmProvider: 'claude',
    editor: 'vscode',
    editorCommand: '',
    workspaceDir: '/cards',
    worktreesDir: '/worktrees',
    jiraSite: '',
    jiraEmail: '',
    jiraApiToken: '',
    jiraConfigured: false,
    onboardingCompleted: true,
  },
  stages: {
    'task-planning': { model: 'fable', effort: 'low' },
    'run-task-checklist': { model: 'fable', effort: 'medium' },
  },
  prompts: { ...DEFAULT_PROMPTS, smartDiffReview: 'instruções de revisão' },
}

test('resets stage models only when the LLM provider changes', () => {
  expect(withGeneralSettings(settings, { ...settings.general, workspaceDir: '/new-cards' }).stages).toEqual(
    settings.stages,
  )
  expect(
    withGeneralSettings(settings, { ...settings.general, llmProvider: 'chatgpt' }).stages['task-planning'].model,
  ).toBe('gpt-6.1-sol')
  expect(withStageSetting(settings, 'run-task-checklist', 'effort', 'max').stages['run-task-checklist'].effort).toBe(
    'max',
  )
})

test('switching from an Ultra model to Luna selects a supported default effort', () => {
  const codex = withGeneralSettings(settings, { ...settings.general, llmProvider: 'chatgpt' })
  const ultra = withStageSetting(codex, 'task-planning', 'effort', 'ultra')
  expect(ultra.stages['task-planning'].effort).toBe('ultra')
  expect(withStageSetting(ultra, 'task-planning', 'model', 'gpt-6-luna').stages['task-planning']).toEqual({
    model: 'gpt-6-luna',
    effort: 'medium',
  })
  expect(withStageSetting(ultra, 'task-planning', 'model', 'gpt-6-astra').stages['task-planning'].effort).toBe('ultra')
})

test('Codex stage defaults preserve roles and respect a restricted account catalog', () => {
  const switched = withGeneralSettings(settings, { ...settings.general, llmProvider: 'chatgpt' })
  expect(switched.stages).toEqual({
    'task-planning': { model: 'gpt-6.1-sol', effort: 'high' },
    'run-task-checklist': { model: 'gpt-6.1-sol', effort: 'medium' },
  })
  expect(switched.prompts).toEqual(settings.prompts)
  const restricted = {
    source: 'codex' as const,
    models: [
      {
        id: 'gpt-6-luna',
        label: 'Luna',
        description: '',
        supportedEfforts: ['low', 'medium', 'high'] as const,
        defaultEffort: 'medium' as const,
        isDefault: true,
      },
    ],
  }
  const catalog = {
    ...restricted,
    models: restricted.models.map((model) => ({ ...model, supportedEfforts: [...model.supportedEfforts] })),
  }
  expect(
    withGeneralSettings(settings, { ...settings.general, llmProvider: 'chatgpt' }, catalog).stages['task-planning'],
  ).toEqual({ model: 'default', effort: 'high' })
})
