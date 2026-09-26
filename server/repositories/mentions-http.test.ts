import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { loadMegaBrainConfig } from '../config'
import type { ApiHandler } from '../contracts'
import { createProductionRouteTable, productionRouteKey } from '../production-routes'

test('production route returns only active mention fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-mention-http-'))
  const settingsFile = join(root, 'settings.json')
  writeFileSync(
    join(root, 'repositories.json'),
    JSON.stringify({
      version: 1,
      repositories: [
        { id: 'one', alias: 'api', displayName: 'API', path: '/private/api', active: true },
        { id: 'two', alias: 'old', displayName: 'Old', path: '/private/old', active: false },
      ],
    }),
  )
  const defaults = loadMegaBrainConfig()
  const routes = createProductionRouteTable({
    config: { ...defaults, preferences: { ...defaults.preferences, settingsFile } },
  })
  const handler = routes.get(productionRouteKey('GET', '/api/repositories/mentions')) as ApiHandler | undefined
  expect(handler).toBeDefined()
  const response = await handler!({
    method: 'GET',
    path: '/api/repositories/mentions',
    query: new URLSearchParams(),
    headers: {},
  })
  expect(response).toMatchObject({ status: 200, body: [{ id: 'one', alias: 'api', displayName: 'API' }] })
})
