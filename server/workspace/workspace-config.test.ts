import { expect, test } from 'vitest'
import { dirname, join, resolve } from 'node:path'
import { completeWorkspaceConfig } from './workspace-config'

test('completes workspace defaults from a minimal input', () => {
  const config = completeWorkspaceConfig({ workspaceDir: '/tmp/mega-brain/cards', executables: { git: 'git' } })

  expect(config.worktreesDir).toBe(join(dirname(resolve('/tmp/mega-brain/cards')), 'worktrees'))
  expect(config.preferences.llmProvider).toBe('claude')
  expect(config.preferences.settingsFile).toBe(join(dirname(resolve('/tmp/mega-brain/cards')), '.mega-brain-global-settings.json'))
  expect(config.executables.git).toBe('git')
})
