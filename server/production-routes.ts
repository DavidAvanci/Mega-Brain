import { createCodexUsageService } from './codex-usage/service'
import { createCodexModelsService } from './codex-models/service'
import { createCodexProfilesStore } from './codex-profiles/service'
import { codexProfilesHttp } from './codex-profiles/http'
import { knowledgeHttp } from './knowledge/http'
import { knowledgeFile, knowledgeService } from './knowledge/service'
import { configureKnowledgeConnection } from './knowledge/agent'
import { activityIslandHttp } from './activity-island/service'
import { cardTriageHttp } from './card-triage/http'
import { createCardTriageService } from './card-triage/service'
import { stderrJsonlLogger } from './logger'
import { basename, join } from 'node:path'
import type { ApiHandler, SseHandler } from './contracts'
import { agentsHttp } from './agents/http'
import { createAgentSessionService } from './agents/service'
import type { MegaBrainConfig } from './config'
import { chatAbortHttp, chatHistoryHttp, chatSendHttp } from './chat/http'
import { createChatService } from './chat/service'
import { claudeUsageHttp } from './claude-usage/http'
import { createClaudeUsageService } from './claude-usage/service'
import { coffeeHttp } from './coffee/http'
import { createCoffeeService } from './coffee/service'
import { jiraReadyHttp, jiraStatusesHttp, jiraTransitionHttp } from './jira/http'
import { createJiraService } from './jira/service'
import type { ProcessOwner, ProcessRunner } from './process'
import { createProcessOwner, nodeProcessRunner } from './process'
import { workspaceHttp } from './workspace/http'
import { createWorkspaceService } from './workspace/service'
import { createDevEnvAgentService } from './modules/dev-environments/dev-env-agent'
import {
  devEnvAgentAbortHttp,
  devEnvAgentControlHttp,
  devEnvAgentHistoryHttp,
  devEnvAgentSendHttp,
} from './modules/dev-environments/dev-env-agent-http'
import { RepositoryRegistry } from './repositories/registry'
import { repositoryCatalogFile } from './repositories/catalog'
import { repositoriesHttp } from './repositories/http'
import { editorExecutable } from './app-settings'
import { openEditor } from './workspace/launchers'

/** The one production composition root for both HTTP transports. */
export type ProductionRouteHandler = ApiHandler | SseHandler
export type ProductionRouteTable = ReadonlyMap<string, ProductionRouteHandler>

export interface ProductionRouteOptions {
  config: MegaBrainConfig
  processOwner?: ProcessOwner
  processRunner?: ProcessRunner
}

export function productionRouteKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`
}

/**
 * Creates each domain service exactly once, then exposes its handlers by their
 * public API route. Vite and the standalone listener deliberately consume this
 * same table; adapters are only allowed to translate native HTTP objects.
 */
export function createProductionRouteTable(options: ProductionRouteOptions): ProductionRouteTable {
  const routes = new Map<string, ProductionRouteHandler>()
  const add = (method: string, path: string, handler: ProductionRouteHandler) =>
    routes.set(productionRouteKey(method, path), (async (request: import('./contracts').ApiRequest) => {
      const host = request.headers.host
      if (host && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host))
        configureKnowledgeConnection(options.config.preferences.settingsFile, { url: `http://${host}` })
      return handler(request)
    }) as ProductionRouteHandler)
  const runner = options.processRunner ?? nodeProcessRunner
  const owner =
    options.processOwner ??
    createProcessOwner({
      signalTree: (pid, signal) => process.kill(-pid, signal),
    })
  const config = options.config
  configureKnowledgeConnection(config.preferences.settingsFile, {
    url: `http://127.0.0.1:${config.mode === 'web' ? 5173 : config.server.port}`,
  })
  const knowledge = knowledgeHttp(knowledgeService(knowledgeFile(config.preferences.settingsFile)))
  for (const [method, path] of [
    ['GET', '/api/knowledge'],
    ['POST', '/api/knowledge'],
    ['GET', '/api/knowledge/search'],
    ['GET', '/api/knowledge/page'],
    ['PUT', '/api/knowledge/page'],
    ['PUT', '/api/knowledge/folder'],
    ['GET', '/api/knowledge/revisions'],
    ['POST', '/api/knowledge/revisions'],
    ['POST', '/api/knowledge/move'],
    ['POST', '/api/knowledge/trash'],
    ['POST', '/api/knowledge/restore'],
    ['POST', '/api/knowledge/agent'],
  ])
    add(method, path, knowledge)
  const windowsCodexHome = process.env.WSL_DISTRO_NAME
    ? join('/mnt/c/Users', basename(config.directories.home), '.codex')
    : undefined
  const codexProfiles = createCodexProfilesStore(config.preferences.settingsFile, {
    homeDir: config.directories.home,
    additionalHomes: windowsCodexHome ? [windowsCodexHome] : [],
  })
  const profilesHttp = codexProfilesHttp(codexProfiles)
  add('GET', '/api/codex/profiles', profilesHttp)
  add('PUT', '/api/codex/profiles', profilesHttp)
  const modelsByHome = new Map<string, ReturnType<typeof createCodexModelsService>>()
  const codexModels = async (refresh = false) => {
    const saved = codexProfiles.read()
    const profile = saved.profiles.find((profile) => profile.id === saved.activeId)!
    let models = modelsByHome.get(profile.home)
    if (!models) {
      models = createCodexModelsService(config.executables.codex, profile.home, runner, owner)
      modelsByHome.set(profile.home, models)
    }
    return { ...(await models.getModels(refresh)), profileId: profile.id, profileName: profile.name }
  }
  add('GET', '/api/codex/models', async (request) => ({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: await codexModels(request.query.get('refresh') === 'true'),
  }))
  const agentService = createAgentSessionService({
    home: config.directories.home,
    claudeHome: config.directories.claudeHome,
    claudeProjects: config.directories.claudeProjects,
    codexProfiles: () => codexProfiles.read().profiles,
    workspaceDir: config.workspaceDir,
    worktreesDir: config.worktreesDir,
  })
  const busyAgentPaths = new Set<string>()
  const chat = createChatService(config, runner, owner, { busyPaths: busyAgentPaths })
  const environmentAgent = createDevEnvAgentService(config, runner, owner, busyAgentPaths)
  add('GET', '/api/dev-env-agent', devEnvAgentHistoryHttp(environmentAgent))
  add('POST', '/api/dev-env-agent/send', devEnvAgentSendHttp(environmentAgent))
  add('POST', '/api/dev-env-agent/abort', devEnvAgentAbortHttp(environmentAgent))
  const workspaceService = createWorkspaceService(
    config,
    runner,
    owner,
    () => agentService.list().sessions,
    codexModels,
  )
  const workspaceAdapter = workspaceHttp(workspaceService)
  add('POST', '/api/dev-env-agent/control', devEnvAgentControlHttp(workspaceService))
  // The workspace handler predates the common /api registry and intentionally
  // keeps its compact domain-relative paths. Normalize once at composition,
  // rather than teaching either HTTP transport a workspace-specific rule.
  const workspace: ApiHandler = (request) =>
    workspaceAdapter({
      ...request,
      path: request.path.slice('/api/workspace'.length) || '/',
    })
  const jira = createJiraService(config.jira)
  const usage = createClaudeUsageService(config.directories.claudeCredentials)
  const usageByHome = new Map<string, ReturnType<typeof createCodexUsageService>>()
  const codexUsage = {
    async getUsage() {
      const saved = codexProfiles.read()
      const profile = saved.profiles.find((profile) => profile.id === saved.activeId)!
      let usage = usageByHome.get(profile.home)
      if (!usage) {
        usage = createCodexUsageService(config.executables.codex, profile.home, runner, owner)
        usageByHome.set(profile.home, usage)
      }
      return { ...(await usage.getUsage()), codexProfileId: profile.id, codexProfileName: profile.name }
    },
  }
  const coffee = coffeeHttp(createCoffeeService(runner, config.executables.powershell, owner))
  const repositoryRegistry = new RepositoryRegistry(repositoryCatalogFile(config.preferences.settingsFile), runner)
  const repositories = repositoriesHttp(repositoryRegistry, async (id) => {
    const path = await repositoryRegistry.checkoutPath(id)
    openEditor(path, editorExecutable(config), runner)
  })
  const agents = agentsHttp(agentService)
  const island = activityIslandHttp(config, () => agentService.list().sessions, {
    chat,
    codexProfiles: () => codexProfiles.read(),
  })
  add('GET', '/api/activity-island', island)
  add('GET', '/api/activity-island/settings', island)
  add('PUT', '/api/activity-island/settings', island)
  add('PATCH', '/api/activity-island/settings', island)
  add('POST', '/api/activity-island/reply', island)
  add('GET', '/api/activity-intent', island)
  add('POST', '/api/activity-intent', island)

  for (const [method, path] of [
    ['GET', '/api/workspace'],
    ['GET', '/api/workspace/settings'],
    ['GET', '/api/workspace/settings/editors'],
    ['GET', '/api/workspace/detail'],
    ['GET', '/api/workspace/diff'],
    ['GET', '/api/workspace/diff/standard'],
    ['POST', '/api/workspace'],
    ['POST', '/api/workspace/settings'],
    ['POST', '/api/workspace/open'],
    ['POST', '/api/workspace/diff'],
    ['POST', '/api/workspace/terminal'],
    ['POST', '/api/workspace/prs/open'],
    ['POST', '/api/workspace/dev-env'],
    ['POST', '/api/workspace/dev-env/preview'],
    ['POST', '/api/workspace/dev-env/logs'],
    ['GET', '/api/workspace/dev-env'],
    ['POST', '/api/workspace/dev-env/stop'],
    ['POST', '/api/workspace/dev-env/open'],
    ['POST', '/api/workspace/dev-env/agent'],
    ['POST', '/api/workspace/stage/pause'],
    ['POST', '/api/workspace/stage/resume'],
    ['POST', '/api/workspace/stage/reset'],
    ['POST', '/api/workspace/update'],
    ['POST', '/api/workspace/delete'],
  ] as const)
    add(method, path, workspace)
  const triage = cardTriageHttp(createCardTriageService(config, { logger: stderrJsonlLogger(process.stderr) }))
  add('POST', '/api/card-triage', triage)
  add('GET', '/api/card-triage', triage)
  add('GET', '/api/chat', chatHistoryHttp(chat))
  add('POST', '/api/chat/send', chatSendHttp(chat))
  add('POST', '/api/chat/abort', chatAbortHttp(chat))
  add('GET', '/api/jira/ready', jiraReadyHttp(jira))
  add('GET', '/api/jira/statuses', jiraStatusesHttp(jira))
  add('POST', '/api/jira/transition', jiraTransitionHttp(jira))
  add('GET', '/api/claude/usage', claudeUsageHttp(usage))
  add('GET', '/api/codex/usage', claudeUsageHttp(codexUsage))
  add('GET', '/api/agents', agents)
  add('POST', '/api/agents/stop', agents)
  add('GET', '/api/coffee', coffee)
  add('POST', '/api/coffee', coffee)
  add('DELETE', '/api/coffee', coffee)
  add('GET', '/api/repositories', repositories)
  add('GET', '/api/repositories/mentions', repositories)
  add('POST', '/api/repositories', repositories)
  add('PATCH', '/api/repositories', repositories)
  add('GET', '/api/repositories/env', repositories)
  add('PUT', '/api/repositories/env', repositories)
  add('POST', '/api/repositories/preview', repositories)
  add('POST', '/api/repositories/discover', repositories)
  add('GET', '/api/repositories/status', repositories)
  add('POST', '/api/repositories/open', repositories)
  add('POST', '/api/repositories/verify', repositories)
  add('POST', '/api/repositories/pull', repositories)
  add('GET', '/api/repositories/migration', repositories)
  add('POST', '/api/repositories/migration', repositories)
  add('POST', '/api/repositories/switch-master', repositories)
  return routes
}
