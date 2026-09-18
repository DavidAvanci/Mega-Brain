import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = fileURLToPath(new URL('.', import.meta.url))
const plugins = ['workspacePlugin.ts', 'chatPlugin.ts', 'jiraPlugin.ts', 'claudeUsagePlugin.ts', 'coffeePlugin.ts']

describe('Vite API adapters', () => {
  test.each(plugins)('%s keeps HTTP transport in the shared Vite adapter', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')

    expect(source).toContain("from './viteApiAdapter'")
    expect(source).toContain('viteApiPlugin(')
    // These are HTTP/domain implementation markers. Plugins may compose
    // handlers, but must not grow a second native HTTP implementation.
    expect(source).not.toMatch(/\.middlewares\.use\(|req\.on\(|res\.(?:end|write|writeHead|setHeader)|new URL\(|legacyJsonError/)
  })

  test('the shared adapter is the only Vite middleware owner', () => {
    const source = readFileSync(new URL('viteApiAdapter.ts', import.meta.url), 'utf8')
    expect(source).toContain('server.middlewares.use')
    expect(source).toContain('legacyJsonError')
    expect(source).toContain('formatSseEvent')
    expect(root).toContain('mega-brain')
  })

  test('the Vite config composes one shared production route table', () => {
    const source = readFileSync(new URL('vite.config.ts', import.meta.url), 'utf8')
    expect(source).toContain("from './viteMegaBrainPlugin'")
    expect(source).toContain('megaBrainVitePlugin(config)')
    for (const legacyPlugin of plugins) expect(source).not.toContain(legacyPlugin.replace('.ts', '').replace('Plugin', 'Plugin('))
  })

  test('keeps the web bootstrap ahead of render and the Vite adapter on localhost:5173', () => {
    const entrypoint = readFileSync(new URL('src/main.tsx', import.meta.url), 'utf8')
    const config = readFileSync(new URL('vite.config.ts', import.meta.url), 'utf8')

    expect(entrypoint).toContain("import { bootstrapWebApiClient } from './apiClient'")
    expect(entrypoint.indexOf('bootstrapWebApiClient()')).toBeLessThan(entrypoint.indexOf('createRoot('))
    expect(config).toContain('megaBrainVitePlugin(config)')
    expect(config).toMatch(/server:\s*\{\s*port:\s*5173,\s*strictPort:\s*true,/)
  })
})
