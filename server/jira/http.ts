import { legacyJsonHandler, type ApiHandler } from '../contracts'
import type { JiraService } from './service'
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const
export const jiraReadyHttp = (service: JiraService): ApiHandler => legacyJsonHandler(async () => ({ status: 200, headers: JSON_HEADERS, body: await service.ready() }))
export const jiraStatusesHttp = (service: JiraService): ApiHandler => legacyJsonHandler(async (r) => ({ status: 200, headers: JSON_HEADERS, body: await service.statuses(r.query.get('keys') ?? '') }))
export const jiraTransitionHttp = (service: JiraService): ApiHandler => legacyJsonHandler(async (r) => { const body = r.body as { key?: string; status?: string } | undefined; return { status: 200, headers: JSON_HEADERS, body: await service.transition(String(body?.key ?? '').toUpperCase(), String(body?.status ?? '')) } })
