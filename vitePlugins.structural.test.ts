import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const root = fileURLToPath(new URL('.', import.meta.url))
describe('Vite API adapters', () => {
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
    expect(source).not.toMatch(/(?:workspace|chat|jira|claudeUsage|coffee)Plugin\(/)
  })

  test('keeps the web bootstrap ahead of render and the Vite adapter on localhost:5173', () => {
    const entrypoint = readFileSync(new URL('src/main.tsx', import.meta.url), 'utf8')
    const config = readFileSync(new URL('vite.config.ts', import.meta.url), 'utf8')

    expect(entrypoint).toContain("import { bootstrapWebApiClient } from './shared/api/api-client'")
    expect(entrypoint.indexOf('bootstrapWebApiClient()')).toBeLessThan(entrypoint.indexOf('createRoot('))
    expect(config).toContain('megaBrainVitePlugin(config)')
    expect(config).toMatch(/server:\s*\{\s*port:\s*5173,\s*strictPort:\s*true,/)
  })
})
