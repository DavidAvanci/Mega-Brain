import type { Plugin } from 'vite'
import { viteApiPlugin } from './viteApiAdapter'
import { createWorkspaceService } from './server/workspace/service'
import { workspaceHttp } from './server/workspace/http'
import type { MegaBrainConfig } from './server/config'

export * from './server/workspace/service'

/** Development-only transport adapter; workspace behavior lives in server/. */
export function workspacePlugin(config: MegaBrainConfig): Plugin {
  return viteApiPlugin('workspace', '/api/workspace', {
    fallback: workspaceHttp(createWorkspaceService(config)),
    allowedMethods: ['GET', 'POST'],
  })
}
