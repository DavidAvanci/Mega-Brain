import { loadMegaBrainConfig } from './config'
import { createStandaloneServer, type StandaloneServer } from './main'
import type { ServerRuntime } from './runtime'

/**
 * Small, side-effect-free backend fixture shared by release/hardening tests.
 * It deliberately has no production imports beyond the HTTP boundary: no
 * workspace, Jira, Claude, Git, WSL, or Tauri process is ever started.
 */
export function createReleaseFixture(options: {
  token: string
  port?: number
  runtime?: ServerRuntime
}): StandaloneServer {
  return createStandaloneServer({
    config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-release-fixture' }),
    listen: { port: options.port ?? 0 },
    sessionToken: options.token,
    runtime: options.runtime ?? {
      register: () => undefined,
      handle: async () => ({ status: 200, body: { fixture: true } }),
    },
  })
}
