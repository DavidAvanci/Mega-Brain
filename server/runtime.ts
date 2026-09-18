import type { ApiHandler, ApiRequest, JsonResponse, SseHandler, SseResponse } from './contracts'
import type { MegaBrainConfig } from './config'
import type { ProcessOwner, ProcessRunner } from './process'
import { createProductionRouteTable, productionRouteKey } from './production-routes'

export type RuntimeResponse = JsonResponse | SseResponse
export type RuntimeHandler = ApiHandler | SseHandler

/**
 * Minimal, framework-neutral route registry.
 *
 * Area services will register their handlers here in subsequent checklist
 * items.  This deliberately does not start a listener: `server/main.ts` is
 * the later HTTP-entrypoint task, while Vite can eventually adapt the same
 * handlers without importing this module's implementation details.
 */
export interface ServerRuntime {
  register(method: string, path: string, handler: RuntimeHandler): void
  /** Introspection for transport parity tests; never an HTTP endpoint. */
  handlerFor?(method: string, path: string): RuntimeHandler | undefined
  handle(request: ApiRequest): Promise<RuntimeResponse | undefined>
}

export interface ServerRuntimeOptions {
  /** Omit this only for an intentionally empty registry in low-level tests. */
  config?: MegaBrainConfig
  /** One lifecycle owner is shared by every backend-owned child process. */
  processOwner?: ProcessOwner
  /** Narrow injection for isolated runtime tests; production uses Node. */
  processRunner?: ProcessRunner
}

/**
 * Compose the production HTTP surface without doing I/O, spawning a process,
 * or contacting a remote service. Services defer those effects until a route
 * is actually invoked, allowing the supervisor to start safely.
 */
export function createServerRuntime(options: ServerRuntimeOptions = {}): ServerRuntime {
  const routes = new Map<string, RuntimeHandler>()
  const runtime: ServerRuntime = {
    register(method, path, handler) {
      routes.set(routeKey(method, path), handler)
    },
    handlerFor(method, path) {
      return routes.get(routeKey(method, path))
    },
    async handle(request) {
      const handler = routes.get(routeKey(request.method, request.path))
      return handler ? handler(request) : undefined
    },
  }
  if (options.config) registerProductionRoutes(runtime, options.config, options)
  return runtime
}

function registerProductionRoutes(runtime: ServerRuntime, config: MegaBrainConfig, options: ServerRuntimeOptions): void {
  const routes = createProductionRouteTable({ config, processRunner: options.processRunner, processOwner: options.processOwner })
  for (const [key, handler] of routes) {
    const [method, path] = key.split(' ', 2)
    runtime.register(method, path, handler)
  }
}

function routeKey(method: string, path: string): string {
  return productionRouteKey(method, path)
}
