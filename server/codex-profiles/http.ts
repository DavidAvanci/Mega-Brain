import { legacyJsonHandler, type ApiHandler } from '../contracts'
import type { CodexProfilesStore } from './service'

export const codexProfilesHttp = (store: CodexProfilesStore): ApiHandler =>
  legacyJsonHandler(async (request) => {
    if (request.method === 'GET')
      return { status: 200, body: store.read(), headers: { 'Content-Type': 'application/json' } }
    if (request.method !== 'PUT') return { status: 405, body: { error: 'Método não permitido.' } }
    try {
      return { status: 200, body: store.write(request.body), headers: { 'Content-Type': 'application/json' } }
    } catch (error) {
      return { status: 400, body: { error: error instanceof Error ? error.message : 'Perfis Codex inválidos.' } }
    }
  })
