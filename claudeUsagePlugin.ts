import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { claudeUsageHttp } from './server/claude-usage/http'
import { createClaudeUsageService, parseUsage } from './server/claude-usage/service'
import { viteApiPlugin } from './viteApiAdapter'
export { parseUsage }
export function claudeUsagePlugin(credentialsFile = join(homedir(), '.claude', '.credentials.json')): Plugin {
  const handler = claudeUsageHttp(createClaudeUsageService(credentialsFile))
  return viteApiPlugin('claude-usage', '/api/claude/usage', { fallback: handler })
}
