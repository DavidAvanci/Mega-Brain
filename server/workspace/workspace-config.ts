import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { MegaBrainConfig } from '../config'

export type WorkspaceConfigInput = Pick<MegaBrainConfig, 'workspaceDir' | 'executables'> &
  Partial<Pick<MegaBrainConfig, 'worktreesDir' | 'preferences'>>

/** Completes the minimal test/runtime input with the workspace defaults. */
export function completeWorkspaceConfig(input: WorkspaceConfigInput): MegaBrainConfig {
  if (input.worktreesDir && input.preferences) return input as MegaBrainConfig
  const home = homedir()
  const workspaceDir = input.workspaceDir
  return {
    mode: 'web',
    server: { host: '127.0.0.1', port: 0 },
    workspaceDir,
    worktreesDir: input.worktreesDir ?? join(dirname(resolve(workspaceDir)), 'worktrees'),
    jira: {},
    laya: { enabled: false },
    directories: {
      home,
      claudeHome: join(home, '.claude'),
      claudeProjects: join(home, '.claude', 'projects'),
      claudeCredentials: join(home, '.claude', '.credentials.json'),
    },
    executables: input.executables,
    preferences: input.preferences ?? {
      settingsFile: join(dirname(resolve(workspaceDir)), '.mega-brain-global-settings.json'),
      editor: 'cursor',
      editorCommand: '',
      llmProvider: 'claude',
      onboardingCompleted: true,
    },
  }
}
