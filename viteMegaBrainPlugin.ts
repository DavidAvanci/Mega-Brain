import type { Plugin } from 'vite'
import type { MegaBrainConfig } from './server/config'
import { createProductionRouteTable, productionRouteKey, type ProductionRouteTable } from './server/production-routes'
import { viteApiPlugin } from './viteApiAdapter'

/**
 * Development HTTP adapter over the exact route table used by the standalone
 * backend. Keep this as one plugin so a Vite server cannot accidentally build
 * a second set of domain services.
 */
export function megaBrainVitePlugin(config: MegaBrainConfig): Plugin {
  return vitePluginForRouteTable(createProductionRouteTable({ config }))
}

export function vitePluginForRouteTable(routes: ProductionRouteTable): Plugin {
  return viteApiPlugin('mega-brain-api', '/api', {
    pathPrefix: '/api',
    fallback: createViteRouteHandler(routes),
  })
}

/** Shared-route lookup kept separate so parity tests can prevent drift. */
export function createViteRouteHandler(routes: ProductionRouteTable) {
  return async (request: Parameters<NonNullable<Parameters<typeof viteApiPlugin>[2]['fallback']>>[0]) => {
      const handler = resolveViteRouteHandler(routes, request.method, request.path)
      if (!handler) return { status: 404, body: { error: 'Rota não encontrada' } }
      return handler(request)
  }
}

/** This lookup must stay a reference lookup: never wrap or recreate handlers. */
export function resolveViteRouteHandler(routes: ProductionRouteTable, method: string, path: string) {
  return routes.get(productionRouteKey(method, path))
}
