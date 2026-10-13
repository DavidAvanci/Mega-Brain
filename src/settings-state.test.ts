import { expect, test } from 'vitest'
import { DEFAULT_PROMPTS, type MegaBrainSettings } from '../shared/domain/settings'
import { defaultStageSettings } from '../shared/domain/codex-models'
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
    ...defaultStageSettings('claude'),
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

test('edits a missing agent in legacy settings without dropping other saved selections', () => {
  const legacy = {
    ...settings,
    stages: {
      'task-planning': { model: 'opus', effort: 'high' },
      'run-task-checklist': { model: 'sonnet', effort: 'medium' },
    },
  } as MegaBrainSettings
  const edited = withStageSetting(legacy, 'task-verification', 'model', 'haiku')
  expect(edited.stages['task-verification']).toEqual({ model: 'haiku', effort: 'medium', fastMode: false })
  expect(edited.stages['run-task-checklist'].model).toBe('sonnet')
  expect(edited.stages['task-planning'].model).toBe('opus')
  expect(withStageSetting(legacy, 'test-environment', 'effort', 'high').stages['test-environment']).toMatchObject({
    model: 'haiku',
    effort: 'high',
  })
})

test('switching from an Ultra model to Luna selects a supported default effort', () => {
  const codex = withGeneralSettings(settings, { ...settings.general, llmProvider: 'chatgpt' })
  const ultra = withStageSetting(codex, 'task-planning', 'effort', 'ultra')
  expect(ultra.stages['task-planning'].effort).toBe('ultra')
  expect(withStageSetting(ultra, 'task-planning', 'model', 'gpt-6-luna').stages['task-planning']).toEqual({
    model: 'gpt-6-luna',
    effort: 'medium',
    fastMode: false,
  })
  expect(withStageSetting(ultra, 'task-planning', 'model', 'gpt-6-astra').stages['task-planning'].effort).toBe('ultra')
})

test('Codex stage defaults preserve roles and respect a restricted account catalog', () => {
  const switched = withGeneralSettings(settings, { ...settings.general, llmProvider: 'chatgpt' })
  expect(switched.stages).toEqual({
    'task-planning': { model: 'gpt-6.1-sol', effort: 'high', fastMode: false },
    'run-task-checklist': { model: 'gpt-6.1-sol', effort: 'medium', fastMode: false },
    'task-verification': { model: 'gpt-6.1-sol', effort: 'medium', fastMode: false },
    'test-environment': { model: 'default', effort: 'medium', fastMode: false },
    'smart-diff-review': { model: 'default', effort: 'medium', fastMode: false },
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
  ).toEqual({ model: 'default', effort: 'high', fastMode: false })
})
