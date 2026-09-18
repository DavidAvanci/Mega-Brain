import type { Plugin } from 'vite'
import { chatAbortHttp, chatHistoryHttp, chatSendHttp } from './server/chat/http'
import { createChatService } from './server/chat/service'
import type { MegaBrainConfig } from './server/config'
import { viteApiPlugin } from './viteApiAdapter'
export * from './server/chat/service'

/** Vite streaming adapter; domain and child-process ownership stay in server/. */
export function chatPlugin(config: MegaBrainConfig): Plugin {
  const service = createChatService(config)
  return viteApiPlugin('chat', '/api/chat', {
    routes: { 'GET /': chatHistoryHttp(service), 'POST /abort': chatAbortHttp(service), 'POST /send': chatSendHttp(service) },
  })
}
