import type { Writable } from 'node:stream'

/** Versioned, stderr-only diagnostic format. Values are deliberately metadata-only. */
export const LOG_SCHEMA_VERSION = 1

export interface LogSink {
  write(line: string): unknown
}
export interface StructuredLogger {
  event(name: string, fields?: Record<string, unknown>): void
}

const sensitiveKey =
  /(token|secret|password|credential|authorization|cookie|jira|email|prompt|content|body|query|header|stack|message|file|path|url)/i
const bearer = /\bBearer\s+[^\s"']+/gi
const credentialUrl = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

/**
 * Produces JSON-safe metadata. This is defense in depth: callers should never
 * send request bodies, headers, user paths, prompts, or Error messages here.
 */
export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[omitted-depth]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string')
    return value.replace(bearer, 'Bearer [redacted]').replace(credentialUrl, '$1[redacted]@')
  if (value instanceof Error) return { name: value.name || 'Error', code: errorCode(value) }
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item, depth + 1))
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = sensitiveKey.test(key) ? '[redacted]' : sanitizeLogValue(item, depth + 1)
    }
    return result
  }
  return `[omitted-${typeof value}]`
}

function errorCode(error: Error): string | undefined {
  const code = (error as Error & { code?: unknown }).code
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined
}

export function createJsonlLogger(
  sink: LogSink,
  sessionId?: string,
  now: () => Date = () => new Date(),
): StructuredLogger {
  return {
    event(name, fields = {}) {
      // Event names and the correlation ids are application-generated, never
      // copied from request input. Safe serialization also prevents a logging
      // failure from changing backend behaviour.
      const record = sanitizeLogValue({
        schemaVersion: LOG_SCHEMA_VERSION,
        timestamp: now().toISOString(),
        event: name,
        ...(sessionId ? { sessionId } : {}),
        ...fields,
      })
      try {
        sink.write(`${JSON.stringify(record)}\n`)
      } catch {
        /* logging is best effort */
      }
    },
  }
}

export function stderrJsonlLogger(stderr: Pick<Writable, 'write'>, sessionId?: string): StructuredLogger {
  return createJsonlLogger(stderr, sessionId)
}
