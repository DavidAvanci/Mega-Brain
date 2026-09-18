import type { Plugin } from 'vite'
import { coffeeHttp } from './server/coffee/http'
import { COFFEE_ARGS, createCoffeeService, type CoffeeService, type SpawnProcess } from './server/coffee/service'
import { viteApiPlugin } from './viteApiAdapter'

export { COFFEE_ARGS }
export function createCoffee(spawnProcess?: SpawnProcess, powershell?: string): CoffeeService { return createCoffeeService(spawnProcess, powershell) }
export function coffeePlugin(coffee: CoffeeService | undefined = undefined, powershell?: string): Plugin {
  coffee ??= createCoffee(undefined, powershell)
  const handler = coffeeHttp(coffee)
  return viteApiPlugin('coffee', '/api/coffee', { fallback: handler }, coffee.stop)
}
