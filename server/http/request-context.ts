import type { IncomingHttpHeaders } from 'node:http'

/** Normalizes Node's multi-value headers for transport-neutral services. */
export function normalizeRequestHeaders(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]),
  )
}

/** Keeps request telemetry free of malformed or query-string route values. */
export function safeRoute(value: string | undefined): string {
  try {
    return new URL(value ?? '/', 'http://localhost').pathname
  } catch {
    return '/'
  }
}
