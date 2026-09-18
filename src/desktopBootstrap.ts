import { ApiClient, configureApiClient } from './apiClient'

/** The only capability the frontend needs from the Rust supervisor. */
export interface BackendSession {
  baseUrl: string
  port?: number
  token: string
}

export interface TauriBridge {
  core: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
}

export interface DesktopWindow {
  __TAURI_INTERNALS__?: unknown
  __TAURI__?: TauriBridge
}

export type DesktopBootstrapFailure = 'bridge-unavailable' | 'supervisor-failed' | 'invalid-session'
  | 'backend-starting' | 'wsl-not-installed' | 'distribution-not-found' | 'runtime-unavailable' | 'invalid-workspace' | 'backend-incompatible'

/**
 * Typed, secret-free failure that the next UI task can turn into a startup
 * state.  Do not put the supervisor response in this error: it contains the
 * session capability.
 */
export class DesktopBootstrapError extends Error {
  constructor(readonly failure: DesktopBootstrapFailure) {
    super(failure === 'bridge-unavailable'
      ? 'The desktop bridge is unavailable'
      : failure === 'supervisor-failed'
        ? 'The desktop backend supervisor did not provide a session'
        : 'The desktop backend session is invalid')
    this.name = 'DesktopBootstrapError'
  }
}

function startupFailure(error: unknown): DesktopBootstrapFailure {
  const detail = error instanceof Error ? error.message : String(error)
  const codes: DesktopBootstrapFailure[] = [
    'backend-starting', 'wsl-not-installed', 'distribution-not-found', 'runtime-unavailable', 'invalid-workspace', 'backend-incompatible',
  ]
  return codes.find((code) => detail.includes(code)) ?? 'supervisor-failed'
}

function currentWindow(): DesktopWindow | undefined {
  return typeof window === 'undefined' ? undefined : window as unknown as DesktopWindow
}

/**
 * Tauri 2 exposes its internal marker plus the explicitly enabled global API.
 * Requiring both avoids treating an ordinary browser page with just one of
 * these names as desktop mode.
 */
export function isTauriDesktop(target: DesktopWindow | undefined = currentWindow()): target is DesktopWindow & { __TAURI__: TauriBridge } {
  return Boolean(target?.__TAURI_INTERNALS__ && typeof target.__TAURI__?.core?.invoke === 'function')
}

function sessionFrom(value: unknown): BackendSession | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.baseUrl !== 'string' || typeof candidate.token !== 'string' || !candidate.token.trim()) return undefined

  let url: URL
  try {
    url = new URL(candidate.baseUrl)
  } catch {
    return undefined
  }
  const port = Number(url.port)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65535 || url.username || url.password || url.search || url.hash) return undefined
  if (candidate.port !== undefined && (!Number.isInteger(candidate.port) || candidate.port !== port)) return undefined
  return { baseUrl: url.origin, port, token: candidate.token }
}

/**
 * Waits for the Rust supervisor before replacing the default web client. The
 * token exists only in this ApiClient instance and is never serialized.
 */
export async function bootstrapDesktopApiClient(target: DesktopWindow | undefined = currentWindow()): Promise<ApiClient> {
  if (!isTauriDesktop(target)) throw new DesktopBootstrapError('bridge-unavailable')
  let response: unknown
  try {
    response = await target.__TAURI__.core.invoke('backend_config')
  } catch (error) {
    throw new DesktopBootstrapError(startupFailure(error))
  }
  const session = sessionFrom(response)
  if (!session) throw new DesktopBootstrapError('invalid-session')
  return configureApiClient({ mode: 'desktop', baseUrl: session.baseUrl, token: session.token })
}

/** The setup UI may only select a name returned by the Rust WSL detector. */
export async function listDesktopWslDistributions(target: DesktopWindow | undefined = currentWindow()): Promise<string[]> {
  if (!isTauriDesktop(target)) throw new DesktopBootstrapError('bridge-unavailable')
  const response = await target.__TAURI__.core.invoke('list_wsl_distributions')
  if (!Array.isArray(response) || response.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new DesktopBootstrapError('supervisor-failed')
  }
  return response
}

export async function selectDesktopWslDistribution(distro: string, target: DesktopWindow | undefined = currentWindow()): Promise<void> {
  if (!isTauriDesktop(target)) throw new DesktopBootstrapError('bridge-unavailable')
  if (!distro.trim()) throw new DesktopBootstrapError('invalid-session')
  await target.__TAURI__.core.invoke('select_wsl_distribution', { distro })
}

/** Persists one absolute POSIX path; Rust verifies it again inside WSL. */
export async function setDesktopWslWorkspaceDir(workspaceDir: string, target: DesktopWindow | undefined = currentWindow()): Promise<void> {
  if (!isTauriDesktop(target)) throw new DesktopBootstrapError('bridge-unavailable')
  const path = workspaceDir.trim()
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\n') || path.includes('\r') || path.split('/').includes('..')) {
    throw new DesktopBootstrapError('invalid-workspace')
  }
  await target.__TAURI__.core.invoke('set_wsl_workspace_dir', { workspaceDir: path })
}

export async function pickDesktopWslDirectory(
  kind: 'workspace' | 'worktrees',
  target: DesktopWindow | undefined = currentWindow(),
): Promise<string | null> {
  if (!isTauriDesktop(target)) throw new DesktopBootstrapError('bridge-unavailable')
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    directory: true,
    multiple: false,
    title: kind === 'workspace' ? 'Escolher workspace dos cards' : 'Escolher raiz das worktrees',
  })
  if (selected === null) return null
  const normalized = await target.__TAURI__.core.invoke('normalize_wsl_directory', { path: selected })
  if (typeof normalized !== 'string' || !normalized.startsWith('/')) throw new DesktopBootstrapError('invalid-workspace')
  return normalized
}
