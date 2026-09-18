/**
 * The only transport boundary for Mega Brain's frontend.  Web mode deliberately
 * keeps Vite's relative URLs; desktop mode is configured by the Tauri bootstrap
 * with a loopback endpoint and an ephemeral in-memory bearer token.
 */
export type ApiClientMode = 'web' | 'desktop'

export interface ApiClientOptions {
  mode?: ApiClientMode
  /** Empty in web mode. In desktop mode this may include a path prefix. */
  baseUrl?: string
  /** Never persist this value: it is intentionally held only by this instance. */
  token?: string
  fetch?: typeof globalThis.fetch
}

export interface ApiRequestOptions extends Omit<RequestInit, 'headers' | 'body'> {
  headers?: HeadersInit
  body?: BodyInit | null
}

export interface JsonRequestOptions extends Omit<ApiRequestOptions, 'body' | 'headers'> {
  headers?: HeadersInit
  body?: unknown
}

export interface SseRequestOptions extends Omit<ApiRequestOptions, 'headers'> {
  headers?: HeadersInit
  onEvent: (event: unknown) => void | Promise<void>
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl) return ''
  const parsed = new URL(baseUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('API base URL must use HTTP(S)')
  return baseUrl.replace(/\/+$/, '')
}

function endpoint(baseUrl: string, path: string): string {
  if (!path.startsWith('/')) throw new Error('API paths must start with /')
  // Do not use new URL(path, base): a leading slash would silently discard a
  // deployment prefix such as http://127.0.0.1:1234/mega-brain.
  return baseUrl ? `${baseUrl}${path}` : path
}

async function responsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text().catch(() => '')
  if (!text) return undefined
  if (contentType.toLowerCase().includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') return payload.error
  if (typeof payload === 'string' && payload.trim()) return payload
  return `Request failed (HTTP ${status})`
}

function parseSseFrame(frame: string): unknown | undefined {
  const data = frame
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
  if (!data.length) return undefined
  const value = data.join('\n')
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: ApiClientOptions = {}) {
    const mode = options.mode ?? 'web'
    if (mode === 'web' && options.token) throw new Error('Web mode must not receive an API token')
    if (mode === 'desktop' && (!options.baseUrl || !options.token)) {
      throw new Error('Desktop mode requires both a loopback base URL and session token')
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.token = options.token
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  async request(path: string, options: ApiRequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    return this.fetchImpl(endpoint(this.baseUrl, path), { ...options, headers })
  }

  async json<T>(path: string, options: JsonRequestOptions = {}): Promise<T> {
    const headers = new Headers(options.headers)
    let body: BodyInit | null | undefined
    if (options.body !== undefined) {
      body = JSON.stringify(options.body)
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    }
    const response = await this.request(path, { ...options, headers, body })
    const payload = await responsePayload(response)
    if (!response.ok) throw new ApiError(errorMessage(response.status, payload), response.status, payload)
    return payload as T
  }

  async sse(path: string, options: SseRequestOptions): Promise<void> {
    const headers = new Headers(options.headers)
    headers.set('Accept', 'text/event-stream')
    const response = await this.request(path, { ...options, headers })
    if (!response.ok) {
      const payload = await responsePayload(response)
      throw new ApiError(errorMessage(response.status, payload), response.status, payload)
    }
    if (!response.body) throw new ApiError('Streaming response has no body', response.status)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        pending += decoder.decode(value, { stream: !done })
        const frames = pending.split(/\r?\n\r?\n/)
        pending = frames.pop() ?? ''
        for (const frame of frames) {
          const event = parseSseFrame(frame)
          if (event !== undefined) await options.onEvent(event)
        }
        if (done) break
      }
      const event = parseSseFrame(pending)
      if (event !== undefined) await options.onEvent(event)
    } finally {
      reader.releaseLock()
    }
  }
}

// This intentionally has no ambient desktop state.  The web entrypoint calls
// bootstrapWebApiClient synchronously before rendering, and a future desktop
// entrypoint will replace it with its own credentials before its first request.
let client = new ApiClient({ mode: 'web', baseUrl: '' })
let clientMode: ApiClientMode = 'web'

/**
 * Establishes the browser/Vite transport synchronously.
 *
 * Do not make this async or infer desktop credentials from globals: a fresh web
 * bootstrap must always discard a previously configured desktop token (including
 * after module re-evaluation during HMR) before any UI can issue a request.
 */
export function bootstrapWebApiClient(fetch?: typeof globalThis.fetch): ApiClient {
  client = new ApiClient({ mode: 'web', baseUrl: '', fetch })
  clientMode = 'web'
  return client
}

/** Replaces the in-memory client; callers must obtain desktop credentials from Tauri first. */
export function configureApiClient(options: ApiClientOptions): ApiClient {
  client = new ApiClient(options)
  clientMode = options.mode ?? 'web'
  return client
}

export function apiClient(): ApiClient {
  return client
}

export function apiClientMode(): ApiClientMode {
  return clientMode
}
