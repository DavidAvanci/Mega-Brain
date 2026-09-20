import { expect, test } from 'vitest'
import type { MegaBrainSettings } from '../shared/domain/settings'
import { withGeneralSettings, withStageSetting } from './settings-state'

const settings: MegaBrainSettings = {
  general: {
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
    'run-test-checklist': { model: 'sonnet', effort: 'high' },
  },
}

test('resets stage models only when the LLM provider changes', () => {
  expect(withGeneralSettings(settings, { ...settings.general, workspaceDir: '/new-cards' }).stages).toEqual(
    settings.stages,
  )
  expect(
    withGeneralSettings(settings, { ...settings.general, llmProvider: 'chatgpt' }).stages['task-planning'].model,
  ).toBe('default')
  expect(withStageSetting(settings, 'run-task-checklist', 'effort', 'max').stages['run-task-checklist'].effort).toBe(
    'max',
  )
})
