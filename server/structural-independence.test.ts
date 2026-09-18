import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { createServerRuntime } from './runtime'

const SERVER_DIRECTORY = new URL('.', import.meta.url)
const FORBIDDEN_IMPORTS = /(?:from\s+['"](?:vite|react|react-dom)|import\s*\(\s*['"](?:vite|react|react-dom))/u

function serverSourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name, directory)
    if (entry.isDirectory()) return serverSourceFiles(new URL(`${entry.name}/`, directory))
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [url] : []
  })
}

describe('server boundary', () => {
  test('registers and invokes handlers without a Vite server', async () => {
    const runtime = createServerRuntime()
    runtime.register('GET', '/health', async () => ({ status: 200, body: { ok: true } }))

    await expect(runtime.handle({
      method: 'GET',
      path: '/health',
      query: new URLSearchParams(),
      headers: {},
    })).resolves.toEqual({ status: 200, body: { ok: true } })
  })

  test('does not import Vite or React', () => {
    const imports = serverSourceFiles(SERVER_DIRECTORY).map((file) => ({
      file: file.pathname,
      source: readFileSync(file, 'utf8'),
    }))

    expect(imports.filter(({ source }) => FORBIDDEN_IMPORTS.test(source))).toEqual([])
  })
})
