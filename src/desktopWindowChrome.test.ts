import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const sourceDir = new URL('.', import.meta.url)

describe('desktop window chrome', () => {
  it('allows the Tauri drag regions to start native window dragging', async () => {
    const capabilityUrl = new URL('../src-tauri/capabilities/desktop-backend.json', sourceDir)
    const capability = JSON.parse(await readFile(capabilityUrl, 'utf8')) as { permissions?: string[] }

    expect(capability.permissions).toContain('core:window:allow-start-dragging')
  })

  it('grants only the native autostart operations used by settings', async () => {
    const capabilityUrl = new URL('../src-tauri/capabilities/desktop-backend.json', sourceDir)
    const capability = JSON.parse(await readFile(capabilityUrl, 'utf8')) as { permissions?: string[] }

    expect(capability.permissions).toEqual(expect.arrayContaining([
      'autostart:allow-enable',
      'autostart:allow-disable',
      'autostart:allow-is-enabled',
    ]))
  })
})
