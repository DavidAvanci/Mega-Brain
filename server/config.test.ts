import { expect, test } from 'vitest'
import { loadMegaBrainConfig } from './config'

test('loads typed runtime configuration from a fixture environment without exposing secrets', () => {
  const config = loadMegaBrainConfig({
    homeDir: '/tmp/mega-brain-home',
    env: {
      MEGA_BRAIN_MODE: 'desktop', WORKSPACE_DIR: '/tmp/workspace',
      JIRA_SITE: 'example', JIRA_EMAIL: 'person@example.test', JIRA_API_TOKEN: 'test-token',
      MEGA_BRAIN_CLAUDE_HOME: '/tmp/claude', MEGA_BRAIN_CLAUDE_PROJECTS_DIR: '/tmp/projects',
      MEGA_BRAIN_CLAUDE_CREDENTIALS_FILE: '/tmp/credentials.json', MEGA_BRAIN_CLAUDE_BIN: '/bin/claude',
      MEGA_BRAIN_GIT_BIN: '/bin/git', MEGA_BRAIN_CURSOR_BIN: '/bin/cursor',
      MEGA_BRAIN_TERMINAL_BIN: '/bin/terminal', MEGA_BRAIN_BROWSER_BIN: '/bin/browser', MEGA_BRAIN_POWERSHELL_BIN: '/bin/powershell',
    },
  })
  expect(config).toMatchObject({
    mode: 'desktop', server: { host: '127.0.0.1', port: 0 }, workspaceDir: '/tmp/workspace', jira: { site: 'example', email: 'person@example.test', token: 'test-token' },
    directories: { home: '/tmp/mega-brain-home', claudeHome: '/tmp/claude', claudeProjects: '/tmp/projects', claudeCredentials: '/tmp/credentials.json' },
    executables: { claude: '/bin/claude', git: '/bin/git', cursor: '/bin/cursor', terminal: '/bin/terminal', browser: '/bin/browser', powershell: '/bin/powershell' },
  })
})

test('preserves web defaults for the current Vite environment', () => {
  const config = loadMegaBrainConfig({ homeDir: '/tmp/home', env: {} })
  expect(config).toMatchObject({ mode: 'web', server: { host: '127.0.0.1', port: 0 }, workspaceDir: './mega-brain-files/workspace', jira: {}, directories: { claudeHome: '/tmp/home/.claude', claudeProjects: '/tmp/home/.claude/projects', claudeCredentials: '/tmp/home/.claude/.credentials.json' } })
})

test('rejects a configured public server host and accepts the dynamic port', () => {
  expect(() => loadMegaBrainConfig({ env: { MEGA_BRAIN_SERVER_HOST: '0.0.0.0' } })).toThrow('bind público não é permitido')
  expect(loadMegaBrainConfig({ env: { MEGA_BRAIN_SERVER_HOST: '127.0.0.1', MEGA_BRAIN_SERVER_PORT: '0' } }).server)
    .toEqual({ host: '127.0.0.1', port: 0 })
})
