import { legacyJsonHandler, type ApiHandler } from '../contracts'
import type { ClaudeUsageService } from './service'
export const claudeUsageHttp = (service: ClaudeUsageService): ApiHandler =>
  legacyJsonHandler(async () => ({
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: await service.getUsage(),
  }))
