import type { ApiHandler } from '../contracts'
import type { createCardTriageService } from './service'
import { validateTriageInput } from './service'

export function cardTriageHttp(service: ReturnType<typeof createCardTriageService>): ApiHandler {
  return async (request) => {
    if (request.method !== 'POST') return { status: 405, body: { error: 'Método inválido' } }
    try {
      return { status: 200, body: await service.triage(validateTriageInput(request.body)) }
    } catch {
      return { status: 400, body: { error: 'Título ou descrição inválidos (limites: 500 e 12000 caracteres)' } }
    }
  }
}
