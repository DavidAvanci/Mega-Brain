import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { completeWorkspaceConfig } from './workspace-config'
import { readWorkspaceSettings } from './workspace-settings'

test('reads general and per-stage settings from the workspace boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-settings-'))
  const config = completeWorkspaceConfig({ workspaceDir: root, executables: {} })

  expect(readWorkspaceSettings(config, root)).toMatchObject({
    general: { workspaceDir: root, llmProvider: 'claude' },
    stages: {},
  })
})
