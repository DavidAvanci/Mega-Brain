import { describe, expect, it, vi } from 'vitest'
import { apiClient, bootstrapWebApiClient } from './apiClient'
import { DesktopBootstrapError, bootstrapDesktopApiClient, isTauriDesktop, pickDesktopWslDirectory, setDesktopWslWorkspaceDir, type DesktopWindow } from './desktopBootstrap'

const { openDirectoryDialog } = vi.hoisted(() => ({ openDirectoryDialog: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openDirectoryDialog }))

const session = { baseUrl: 'http://127.0.0.1:43123', port: 43123, token: 'memory-only-session-token' }

function desktop(response: unknown = session): DesktopWindow {
  return { __TAURI_INTERNALS__: {}, __TAURI__: { core: { invoke: vi.fn().mockResolvedValue(response) } } }
}

describe('desktop API bootstrap', () => {
  it('obtains the supervisor session before configuring memory-only desktop transport', async () => {
    const bridge = desktop()
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    const oldLocal = globalThis.localStorage
    const oldSession = globalThis.sessionStorage
    const oldFetch = globalThis.fetch
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
    try {
      const fetch = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }))
      globalThis.fetch = fetch
      bootstrapWebApiClient(fetch)
      await bootstrapDesktopApiClient(bridge)
      await apiClient().json('/api/health')

      expect(bridge.__TAURI__!.core.invoke).toHaveBeenCalledWith('backend_config')
      expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:43123/api/health', expect.objectContaining({ headers: expect.any(Headers) }))
      expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe(`Bearer ${session.token}`)
      expect(storage.getItem).not.toHaveBeenCalled()
      expect(storage.setItem).not.toHaveBeenCalled()
      expect(storage.removeItem).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = oldFetch
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: oldLocal })
      Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: oldSession })
    }
  })

  it('does not issue an API request before the supervisor handshake resolves', async () => {
    let resolve!: (value: unknown) => void
    const pending = new Promise<unknown>((done) => { resolve = done })
    const bridge = desktop(pending)
    const fetch = vi.fn()
    bootstrapWebApiClient(fetch)
    const boot = bootstrapDesktopApiClient(bridge)
    expect(fetch).not.toHaveBeenCalled()
    resolve(session)
    await boot
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    { ...session, baseUrl: 'https://127.0.0.1:43123' },
    { ...session, baseUrl: 'http://localhost:43123' },
    { ...session, port: 99 },
    { ...session, token: '' },
  ])('rejects invalid supervisor payload without exposing it', async (payload) => {
    await expect(bootstrapDesktopApiClient(desktop(payload))).rejects.toEqual(expect.objectContaining({ name: 'DesktopBootstrapError', failure: 'invalid-session' }))
  })

  it('returns a typed failure when the supervisor invoke fails', async () => {
    const bridge = desktop()
    vi.mocked(bridge.__TAURI__!.core.invoke).mockRejectedValueOnce(new Error(session.token))
    await expect(bootstrapDesktopApiClient(bridge)).rejects.toEqual(expect.objectContaining({ name: 'DesktopBootstrapError', failure: 'supervisor-failed' }))
  })

  it('preserves a secret-free actionable supervisor failure code', async () => {
    const bridge = {
      __TAURI_INTERNALS__: {},
      __TAURI__: { core: { invoke: vi.fn().mockRejectedValue(new Error('distribution-not-found')) } },
    }
    await expect(bootstrapDesktopApiClient(bridge)).rejects.toEqual(expect.objectContaining({
      name: 'DesktopBootstrapError', failure: 'distribution-not-found',
    }))
  })

  it('keeps ordinary web pages out of desktop mode when the bridge is absent or incomplete', async () => {
    expect(isTauriDesktop({})).toBe(false)
    expect(isTauriDesktop({ __TAURI__: desktop().__TAURI__ })).toBe(false)
    await expect(bootstrapDesktopApiClient({})).rejects.toEqual(expect.objectContaining({ name: 'DesktopBootstrapError', failure: 'bridge-unavailable' }))
    expect(DesktopBootstrapError).toBeTypeOf('function')
  })

  it('sends only a validated absolute WSL workspace path through the narrow IPC command', async () => {
    const bridge = desktop()
    await setDesktopWslWorkspaceDir(' /home/alice/brain ', bridge)
    expect(bridge.__TAURI__!.core.invoke).toHaveBeenCalledWith('set_wsl_workspace_dir', { workspaceDir: '/home/alice/brain' })
    await expect(setDesktopWslWorkspaceDir('C:\\brain', bridge)).rejects.toEqual(expect.objectContaining({ failure: 'invalid-workspace' }))
    await expect(setDesktopWslWorkspaceDir('/tmp/../etc', bridge)).rejects.toEqual(expect.objectContaining({ failure: 'invalid-workspace' }))
  })

  it('normalizes only a directory explicitly returned by the native picker', async () => {
    const bridge = desktop('/home/alice/brain')
    openDirectoryDialog.mockResolvedValueOnce('C:\\Users\\alice\\brain')
    await expect(pickDesktopWslDirectory('workspace', bridge)).resolves.toBe('/home/alice/brain')
    expect(openDirectoryDialog).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }))
    expect(bridge.__TAURI__!.core.invoke).toHaveBeenCalledWith('normalize_wsl_directory', { path: 'C:\\Users\\alice\\brain' })

    openDirectoryDialog.mockResolvedValueOnce(null)
    await expect(pickDesktopWslDirectory('worktrees', bridge)).resolves.toBeNull()
  })
})
