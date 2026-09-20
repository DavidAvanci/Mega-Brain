import { legacyJsonHandler, type ApiHandler } from '../contracts'
import type { CoffeeService } from './service'
export function coffeeHttp(service: CoffeeService): ApiHandler {
  return legacyJsonHandler(async ({ method }) => {
    if (method === 'POST') service.start()
    if (method === 'DELETE') service.stop()
    return { status: 200, headers: { 'Content-Type': 'application/json' }, body: { active: service.active() } }
  })
}
