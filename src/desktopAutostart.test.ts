import { beforeEach, describe, expect, it, vi } from 'vitest'

const autostart = vi.hoisted(() => ({
  disable: vi.fn(),
  enable: vi.fn(),
  isEnabled: vi.fn(),
}))
const desktop = vi.hoisted(() => ({ active: true }))

vi.mock('@tauri-apps/plugin-autostart', () => autostart)
vi.mock('./desktopBootstrap', () => ({ isTauriDesktop: () => desktop.active }))

import { getDesktopAutostartEnabled, setDesktopAutostartEnabled } from './desktopAutostart'

describe('desktop autostart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    desktop.active = true
  })

  it('reads and changes the native autostart registration', async () => {
    autostart.isEnabled.mockResolvedValueOnce(true)

    await expect(getDesktopAutostartEnabled()).resolves.toBe(true)
    await setDesktopAutostartEnabled(true)
    await setDesktopAutostartEnabled(false)

    expect(autostart.enable).toHaveBeenCalledOnce()
    expect(autostart.disable).toHaveBeenCalledOnce()
  })

  it('does not expose autostart mutations to the web app', async () => {
    desktop.active = false

    await expect(getDesktopAutostartEnabled()).resolves.toBe(false)
    await expect(setDesktopAutostartEnabled(true)).rejects.toThrow('aplicativo desktop')
    expect(autostart.isEnabled).not.toHaveBeenCalled()
  })
})
