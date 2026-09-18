import type { Plugin } from 'vite'
import { jiraReadyHttp, jiraStatusesHttp, jiraTransitionHttp } from './server/jira/http'
import { createJiraService, type JiraEnv } from './server/jira/service'
import { viteApiPlugin } from './viteApiAdapter'
export * from './server/jira/service'

/** Development-only adapter. Jira domain behavior is Vite-independent. */
export function jiraPlugin(env: JiraEnv): Plugin {
  const service = createJiraService(env)
  const handlers = { '/ready': jiraReadyHttp(service), '/statuses': jiraStatusesHttp(service), '/transition': jiraTransitionHttp(service) }
  return viteApiPlugin('jira', '/api/jira', { routes: {
    'GET /ready': handlers['/ready'], 'GET /statuses': handlers['/statuses'], 'POST /transition': handlers['/transition'],
  } })
}
