import { expect, test } from 'vitest'
import { completeWorkspaceConfig } from './workspace-config'

test('completes workspace defaults from a minimal input', () => {
  const config = completeWorkspaceConfig({ workspaceDir: '/tmp/mega-brain/cards', executables: { git: 'git' } })

  expect(config.worktreesDir).toBe('/tmp/mega-brain/worktrees')
  expect(config.preferences.llmProvider).toBe('claude')
  expect(config.preferences.settingsFile).toBe('/tmp/mega-brain/.mega-brain-global-settings.json')
  expect(config.executables.git).toBe('git')
})
