import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { JiraEnv } from './jira/service'
import type { EditorPreference, LlmProvider } from '../src/types'

/**
 * Runtime configuration shared by the Vite development adapter and the future
 * standalone server.  This module deliberately only reads values: validation
 * of workspace paths belongs to the next hardening step.
 */
export type ExecutionMode = 'web' | 'desktop'

export interface MegaBrainConfig {
  mode: ExecutionMode
  /**
   * Network defaults for the independent backend. This never inherits Vite's
   * host or port: the desktop API is deliberately a private loopback service.
   */
  server: {
    host: '127.0.0.1'
    port: number
  }
  workspaceDir: string
  worktreesDir: string
  jira: JiraEnv
  directories: {
    home: string
    claudeHome: string
    claudeProjects: string
    claudeCredentials: string
  }
  executables: {
    claude?: string
    git?: string
    cursor?: string
    code?: string
    codex?: string
    terminal?: string
    browser?: string
    powershell?: string
  }
  preferences: {
    settingsFile: string
    editor: EditorPreference
    editorCommand: string
    llmProvider: LlmProvider
    onboardingCompleted: boolean
  }
}

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>

export interface LoadMegaBrainConfigOptions {
  env?: ConfigEnvironment
  homeDir?: string
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function executionMode(value: string | undefined): ExecutionMode {
  return value === 'desktop' ? 'desktop' : 'web'
}

function persistedSettings(file: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function savedAbsolutePath(value: unknown): string | undefined {
  return typeof value === 'string' && isAbsolute(value.trim()) ? value.trim() : undefined
}

function savedString(value: unknown): string | undefined {
  return typeof value === 'string' ? optional(value) : undefined
}

function serverPort(value: string | undefined): number {
  const raw = optional(value) ?? '0'
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('MEGA_BRAIN_SERVER_PORT deve ser uma porta entre 0 e 65535')
  }
  return port
}

function loopbackHost(value: string | undefined): '127.0.0.1' {
  const requested = optional(value)
  if (requested && requested !== '127.0.0.1') {
    throw new Error('MEGA_BRAIN_SERVER_HOST deve ser 127.0.0.1; bind público não é permitido')
  }
  return '127.0.0.1'
}

/** Does not log or serialize credentials. Supply a fixture env in tests. */
export function loadMegaBrainConfig(options: LoadMegaBrainConfigOptions = {}): MegaBrainConfig {
  const env = options.env ?? process.env
  const home = options.homeDir ?? homedir()
  const claudeHome = optional(env.MEGA_BRAIN_CLAUDE_HOME) ?? join(home, '.claude')
  const settingsFile = optional(env.MEGA_BRAIN_SETTINGS_FILE) ?? join(home, '.config', 'mega-brain', 'settings.json')
  const saved = persistedSettings(settingsFile)
  const defaultWorkspaceDir = optional(env.WORKSPACE_DIR) ?? './mega-brain-files/workspace'
  const workspaceDir = savedAbsolutePath(saved.workspaceDir) ?? defaultWorkspaceDir
  const worktreesDir = savedAbsolutePath(saved.worktreesDir)
    ?? optional(env.MEGA_BRAIN_WORKTREES_DIR)
    ?? join(dirname(workspaceDir), 'worktrees')
  const editorChoices: ReadonlySet<EditorPreference> = new Set(['cursor', 'vscode', 'windsurf', 'zed', 'sublime', 'intellij', 'webstorm', 'pycharm', 'custom'])
  const editor = editorChoices.has(saved.editor as EditorPreference) ? saved.editor as EditorPreference : 'cursor'
  const llmProvider = saved.llmProvider === 'chatgpt' ? 'chatgpt' : 'claude'
  return {
    mode: executionMode(env.MEGA_BRAIN_MODE),
    server: {
      host: loopbackHost(env.MEGA_BRAIN_SERVER_HOST),
      port: serverPort(env.MEGA_BRAIN_SERVER_PORT),
    },
    workspaceDir,
    worktreesDir,
    jira: {
      site: optional(env.JIRA_SITE) ?? savedString(saved.jiraSite),
      email: optional(env.JIRA_EMAIL) ?? savedString(saved.jiraEmail),
      token: optional(env.JIRA_API_TOKEN) ?? savedString(saved.jiraApiToken),
    },
    directories: {
      home,
      claudeHome,
      claudeProjects: optional(env.MEGA_BRAIN_CLAUDE_PROJECTS_DIR) ?? join(claudeHome, 'projects'),
      claudeCredentials: optional(env.MEGA_BRAIN_CLAUDE_CREDENTIALS_FILE) ?? join(claudeHome, '.credentials.json'),
    },
    executables: {
      claude: optional(env.MEGA_BRAIN_CLAUDE_BIN),
      git: optional(env.MEGA_BRAIN_GIT_BIN),
      cursor: optional(env.MEGA_BRAIN_CURSOR_BIN),
      code: optional(env.MEGA_BRAIN_CODE_BIN),
      codex: optional(env.MEGA_BRAIN_CODEX_BIN),
      terminal: optional(env.MEGA_BRAIN_TERMINAL_BIN),
      browser: optional(env.MEGA_BRAIN_BROWSER_BIN),
      powershell: optional(env.MEGA_BRAIN_POWERSHELL_BIN),
    },
    preferences: {
      settingsFile,
      editor,
      editorCommand: typeof saved.editorCommand === 'string' ? saved.editorCommand.trim() : '',
      llmProvider,
      onboardingCompleted: saved.onboardingCompleted === true,
    },
  }
}
