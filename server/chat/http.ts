import { legacyJsonHandler, type ApiHandler, type SseHandler } from '../contracts'
import type { ChatEvent } from '../../shared/contracts/chat'
import type { ChatService } from './service'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const
export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const

/** The exact frame consumed by src/cards.ts. */
export function formatSseEvent(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export const chatHistoryHttp = (service: ChatService): ApiHandler =>
  legacyJsonHandler(async (r) => ({
    status: 200,
    headers: JSON_HEADERS,
    body: await service.history(String(r.query.get('name') ?? '')),
  }))
export const chatAbortHttp = (service: ChatService): ApiHandler =>
  legacyJsonHandler(async (r) => ({
    status: 200,
    headers: JSON_HEADERS,
    body: {
      ok: service.abort(
        String((r.body && typeof r.body === 'object' ? (r.body as Record<string, unknown>).name : '') ?? ''),
      ),
    },
  }))

export const chatSendHttp =
  (service: ChatService): SseHandler<ChatEvent> =>
  async (r) => {
    const body = r.body as { name?: unknown; text?: unknown } | undefined
    return {
      status: 200,
      headers: SSE_HEADERS,
      cancel: () => {
        service.abort(String(body?.name ?? ''))
      },
      stream: (emit) => {
        try {
          service.send(String(body?.name ?? ''), String(body?.text ?? ''), emit)
        } catch (error) {
          emit({ type: 'done', error: error instanceof Error ? error.message : String(error) })
        }
      },
    }
  }
