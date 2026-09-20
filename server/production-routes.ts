import type { ApiHandler, SseHandler } from './contracts'
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
    routes.set(productionRouteKey(method, path), handler)
  const runner = options.processRunner ?? nodeProcessRunner
  const owner =
    options.processOwner ??
    createProcessOwner({
      signalTree: (pid, signal) => process.kill(-pid, signal),
    })
  const config = options.config
  const workspaceAdapter = workspaceHttp(createWorkspaceService(config, runner, owner))
  // The workspace handler predates the common /api registry and intentionally
  // keeps its compact domain-relative paths. Normalize once at composition,
  // rather than teaching either HTTP transport a workspace-specific rule.
  const workspace: ApiHandler = (request) =>
    workspaceAdapter({
      ...request,
      path: request.path.slice('/api/workspace'.length) || '/',
    })
  const chat = createChatService(config, runner, owner)
  const jira = createJiraService(config.jira)
  const usage = createClaudeUsageService(config.directories.claudeCredentials)
  const coffee = coffeeHttp(createCoffeeService(runner, config.executables.powershell, owner))

  for (const [method, path] of [
    ['GET', '/api/workspace'],
    ['GET', '/api/workspace/settings'],
    ['GET', '/api/workspace/settings/editors'],
    ['GET', '/api/workspace/detail'],
    ['GET', '/api/workspace/diff'],
    ['POST', '/api/workspace'],
    ['POST', '/api/workspace/settings'],
    ['POST', '/api/workspace/open'],
    ['POST', '/api/workspace/terminal'],
    ['POST', '/api/workspace/prs/open'],
    ['POST', '/api/workspace/dev-env'],
    ['POST', '/api/workspace/dev-env/stop'],
    ['POST', '/api/workspace/dev-env/open'],
    ['POST', '/api/workspace/dev-env/agent'],
    ['POST', '/api/workspace/stage/reset'],
    ['POST', '/api/workspace/update'],
    ['POST', '/api/workspace/delete'],
  ] as const)
    add(method, path, workspace)
  add('GET', '/api/chat', chatHistoryHttp(chat))
  add('POST', '/api/chat/send', chatSendHttp(chat))
  add('POST', '/api/chat/abort', chatAbortHttp(chat))
  add('GET', '/api/jira/ready', jiraReadyHttp(jira))
  add('GET', '/api/jira/statuses', jiraStatusesHttp(jira))
  add('POST', '/api/jira/transition', jiraTransitionHttp(jira))
  add('GET', '/api/claude/usage', claudeUsageHttp(usage))
  add('POST', '/api/coffee', coffee)
  add('DELETE', '/api/coffee', coffee)
  return routes
}
