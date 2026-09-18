/**
 * Transport-neutral contracts for the standalone backend.
 *
 * HTTP adapters (the future Node server and the existing Vite adapters) may
 * translate their native request/response objects to these types.  Keeping
 * the types here makes the domain boundary usable without Vite or React.
 */
export interface ApiRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: Readonly<Record<string, string | undefined>>
  body?: unknown
}

export interface JsonResponse {
  status: number
  body: unknown
  headers?: Readonly<Record<string, string>>
}

export type ApiHandler = (request: ApiRequest) => Promise<JsonResponse>

/** Error envelope emitted by the Vite API today and consumed by readJson(). */
export function legacyJsonError(error: unknown): JsonResponse {
  return {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
    body: { error: error instanceof Error ? error.message : String(error) },
  }
}

/**
 * Keeps the JSON failure contract at the HTTP boundary while services remain
 * free to throw domain errors.  Both Vite and the standalone server can use
 * this without knowing about individual service implementations.
 */
export function legacyJsonHandler(handler: ApiHandler): ApiHandler {
  return async (request) => {
    try {
      return await handler(request)
    } catch (error) {
      return legacyJsonError(error)
    }
  }
}

/**
 * The chat endpoint is deliberately modelled separately from JSON responses:
 * the React client consumes one JSON event per `data:` frame and relies on the
 * blank-line delimiter.  Keeping that detail at the transport boundary avoids
 * accidentally changing it while moving away from Vite.
 */
export interface SseResponse<Event = unknown> {
  status: number
  headers: Readonly<Record<string, string>>
  stream(emit: (event: Event) => void): void
  /** Called when the HTTP peer goes away before the stream has completed. */
  cancel?(): void
}

export type SseHandler<Event = unknown> = (request: ApiRequest) => Promise<SseResponse<Event>>
