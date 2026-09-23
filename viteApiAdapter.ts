import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { legacyJsonError, type ApiRequest, type JsonResponse, type SseResponse } from './server/contracts'
import { formatSseEvent } from './server/chat/http'

type RouteHandler = (request: ApiRequest) => Promise<JsonResponse | SseResponse>

export interface ViteApiAdapterOptions {
  /** A handler used for every path below the mount point. */
  fallback?: RouteHandler
  routes?: Readonly<Record<string, RouteHandler>>
  allowedMethods?: readonly string[]
  /** Reconstruct Connect's mount-stripped path for shared absolute routes. */
  pathPrefix?: string
}

/**
 * Vite-only transport glue. Domain handlers remain in `server/`; this file
 * converts Connect's request/response objects to the neutral HTTP contract.
 */
export function createViteApiAdapter(options: ViteApiAdapterOptions) {
  const allowed = options.allowedMethods && new Set(options.allowedMethods)
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = (req.method ?? 'GET').toUpperCase()
    if (allowed && !allowed.has(method)) return next()
    const handler =
      options.routes?.[`${method} ${url.pathname}`] ?? options.routes?.[`* ${url.pathname}`] ?? options.fallback
    if (!handler) return next()
    const path = options.pathPrefix ? `${options.pathPrefix}${url.pathname === '/' ? '' : url.pathname}` : url.pathname
    readBody(req)
      .then((body) => handler({ method, path, query: url.searchParams, headers: requestHeaders(req), body }))
      .then((result) => writeResult(res, result))
      .catch((error) => writeJson(res, legacyJsonError(error)))
  }
}

export function viteApiPlugin(
  name: string,
  mount: string,
  options: ViteApiAdapterOptions,
  onClose?: () => void,
): Plugin {
  const middleware = createViteApiAdapter(options)
  return {
    name,
    configureServer(server) {
      if (onClose) server.httpServer?.on('close', onClose)
      server.middlewares.use(mount, middleware)
    },
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += String(chunk)
    })
    req.on('end', () => {
      if (!raw) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function requestHeaders(req: IncomingMessage): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]),
  )
}

function writeResult(res: ServerResponse, result: JsonResponse | SseResponse): void {
  if ('stream' in result) {
    res.writeHead(result.status, result.headers)
    res.once('close', () => result.cancel?.())
    result.stream((event) => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(formatSseEvent(event as never))
        if ((event as { type?: string }).type === 'done') res.end()
      }
    })
    return
  }
  writeJson(res, result)
}

function writeJson(res: ServerResponse, result: JsonResponse): void {
  res.statusCode = result.status
  for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value)
  res.end(JSON.stringify(result.body))
}
