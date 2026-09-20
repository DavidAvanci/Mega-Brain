import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SseResponse } from '../contracts'
import { formatSseEvent } from '../chat/http'

export function isSseResponse(result: unknown): result is SseResponse {
  return Boolean(result && typeof result === 'object' && 'stream' in result && typeof result.stream === 'function')
}

/** Writes each SSE event immediately and cancels exactly once on peer disconnect. */
export function writeSse(request: IncomingMessage, response: ServerResponse, result: SseResponse): void {
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value)
  response.statusCode = result.status
  response.flushHeaders()
  let complete = false
  let cancelled = false
  const cancel = () => {
    if (complete || cancelled) return
    cancelled = true
    result.cancel?.()
  }
  const onClose = () => cancel()
  request.once('aborted', cancel)
  response.once('close', onClose)
  const finish = () => {
    if (complete) return
    complete = true
    request.off('aborted', cancel)
    response.off('close', onClose)
    if (!response.writableEnded && !response.destroyed) response.end()
  }
  try {
    result.stream((event: unknown) => {
      if (complete || cancelled || response.writableEnded || response.destroyed) return
      response.write(formatSseEvent(event))
      if (event && typeof event === 'object' && (event as { type?: unknown }).type === 'done') finish()
    })
  } catch {
    if (!cancelled && !response.writableEnded && !response.destroyed) {
      response.write(formatSseEvent({ type: 'done', error: 'Falha ao transmitir resposta' }))
      finish()
    }
  }
}
