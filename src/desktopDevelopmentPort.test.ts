import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const sourceDir = new URL('.', import.meta.url)
const desktopOrigin = 'http://127.0.0.1:15173'

describe('desktop development port', () => {
  it('keeps the Tauri shell, launcher, supervisor and backend CORS on the reserved origin', async () => {
    const [tauriConfig, launcher, supervisor, cors] = await Promise.all([
      readFile(new URL('../src-tauri/tauri.conf.json', sourceDir), 'utf8'),
      readFile(new URL('../scripts/tauri-dev.mjs', sourceDir), 'utf8'),
      readFile(new URL('../src-tauri/src/supervisor.rs', sourceDir), 'utf8'),
      readFile(new URL('../server/cors.ts', sourceDir), 'utf8'),
    ])

    expect(JSON.parse(tauriConfig)).toMatchObject({ build: { devUrl: desktopOrigin } })
    for (const source of [launcher, supervisor, cors]) expect(source).toContain(desktopOrigin)
  })

  it('keeps the standalone web development server on 5173', async () => {
    const viteConfig = await readFile(new URL('../vite.config.ts', sourceDir), 'utf8')

    expect(viteConfig).toMatch(/server:\s*\{\s*port:\s*5173,\s*strictPort:\s*true,/)
  })
})
