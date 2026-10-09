import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { completeWorkspaceConfig } from './workspace-config'
import { readWorkspaceSettings, writeWorkspaceSettings } from './workspace-settings'

test('reads general and per-stage settings from the workspace boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-settings-'))
  const config = completeWorkspaceConfig({ workspaceDir: root, executables: {} })

  expect(readWorkspaceSettings(config, root)).toMatchObject({
    general: { workspaceDir: root, llmProvider: 'claude' },
    stages: {},
  })
})

test('keeps knowledge beside cards and follows a changed workspace parent', () => {
  const root = mkdtempSync(join(tmpdir(), 'workspace-knowledge-settings-'))
  try {
    const config = completeWorkspaceConfig({ workspaceDir: join(root, 'cards'), executables: {} })
    config.preferences.settingsFile = join(root, 'app-config', 'settings.json')
    const settings = readWorkspaceSettings(config, config.workspaceDir)
    expect(settings.general.knowledgeDir).toBe(join(root, 'knowledge'))
    const saved = writeWorkspaceSettings(config, {
      general: {
        ...settings.general,
        editor: 'custom',
        editorCommand: '/bin/sh',
        workspaceDir: join(root, 'new-workspace', 'cards'),
        worktreesDir: join(root, 'new-worktrees'),
        knowledgeDir: join(root, 'other-knowledge'),
      },
    })
    expect(saved.settings.general.knowledgeDir).toBe(join(root, 'new-workspace', 'knowledge'))
    expect(JSON.parse(readFileSync(config.preferences.settingsFile, 'utf8'))).not.toHaveProperty('knowledgeDir')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
