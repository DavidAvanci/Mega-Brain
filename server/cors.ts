/**
 * CORS policy for the desktop-only loopback listener.
 *
 * These values are deliberately constants, rather than configuration: an
 * arbitrary Origin from an environment variable would turn a local desktop
 * capability into a cross-origin API.  The two origins are the Tauri 2
 * Windows origins proven by the loopback spike.
 */
export const TAURI_ALLOWED_ORIGINS = ['http://tauri.localhost', 'https://tauri.localhost'] as const
const TAURI_DEV_ORIGIN = 'http://127.0.0.1:15173'

export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'DELETE'] as const
export const CORS_ALLOWED_HEADERS = ['Authorization', 'Content-Type'] as const

const allowedOrigins = new Set<string>([
  ...TAURI_ALLOWED_ORIGINS,
  ...(process.env.MEGA_BRAIN_DEV_ORIGIN === TAURI_DEV_ORIGIN ? [TAURI_DEV_ORIGIN] : []),
])
const allowedMethods = new Set<string>(CORS_ALLOWED_METHODS)
const allowedHeaders = new Set(CORS_ALLOWED_HEADERS.map((header) => header.toLowerCase()))

export type CorsDecision =
  { kind: 'absent' } | { kind: 'actual'; origin: string } | { kind: 'preflight'; origin: string } | { kind: 'reject' }

/**
 * Evaluates an Origin exactly; prefixes, suffixes, ports and lookalike hosts
 * never match.  OPTIONS is exclusively a CORS preflight on this listener.
 */
export function evaluateCors(method: string | undefined, headers: Record<string, string | undefined>): CorsDecision {
  const origin = headers.origin
  const normalizedMethod = (method ?? 'GET').toUpperCase()

  if (!origin) return normalizedMethod === 'OPTIONS' ? { kind: 'reject' } : { kind: 'absent' }
  if (!allowedOrigins.has(origin)) return { kind: 'reject' }
  if (normalizedMethod !== 'OPTIONS') return { kind: 'actual', origin }

  const requestedMethod = headers['access-control-request-method']?.toUpperCase()
  if (!requestedMethod || !allowedMethods.has(requestedMethod)) return { kind: 'reject' }
  const requestedHeaders = parseRequestedHeaders(headers['access-control-request-headers'])
  if (!requestedHeaders || requestedHeaders.some((header) => !allowedHeaders.has(header))) return { kind: 'reject' }
  return { kind: 'preflight', origin }
}

function parseRequestedHeaders(value: string | undefined): string[] | undefined {
  if (!value) return []
  const names = value.split(',').map((header) => header.trim().toLowerCase())
  return names.some((header) => !header) ? undefined : names
}

export function corsResponseHeaders(decision: Extract<CorsDecision, { origin: string }>): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': decision.origin,
    Vary: 'Origin',
  }
  if (decision.kind === 'preflight') {
    headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS.join(', ')
    headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS.join(', ')
  }
  return headers
}
