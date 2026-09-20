import type { IncomingMessage } from 'node:http'

export interface HttpLimits {
  maxBodyBytes: number
  maxHeaderBytes: number
  headersTimeoutMs: number
  bodyIdleTimeoutMs: number
  shortRouteTimeoutMs: number
}

/** Limits ordinary JSON requests without imposing a deadline on SSE streams. */
export const DEFAULT_HTTP_LIMITS: HttpLimits = {
  maxBodyBytes: 1_048_576,
  maxHeaderBytes: 16_384,
  headersTimeoutMs: 15_000,
  bodyIdleTimeoutMs: 15_000,
  shortRouteTimeoutMs: 30_000,
}

export class RequestBodyTooLargeError extends Error {}
export class RequestTimeoutError extends Error {}

export async function readJsonBody(request: IncomingMessage, limits: HttpLimits): Promise<unknown> {
  const declaredLength = request.headers['content-length']
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limits.maxBodyBytes)) {
    request.resume()
    throw new RequestBodyTooLargeError()
  }
  const chunks: Buffer[] = []
  let bytes = 0
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => request.destroy(new RequestTimeoutError()), limits.bodyIdleTimeoutMs)
  }
  resetIdleTimer()
  try {
    for await (const chunk of request) {
      resetIdleTimer()
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += value.length
      if (bytes > limits.maxBodyBytes) {
        request.resume()
        throw new RequestBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

export function isLongRunningRoute(method: string | undefined, path: string): boolean {
  return (
    method?.toUpperCase() === 'POST' &&
    (path === '/api/chat/send' || path.endsWith('/stages') || path.includes('/stage/'))
  )
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new RequestTimeoutError()), timeoutMs)
    promise.then(resolve, reject).finally(() => {
      if (timer) clearTimeout(timer)
    })
  })
}
