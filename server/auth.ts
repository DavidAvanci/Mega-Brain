import { randomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN_BYTES = 32
const MINIMUM_TOKEN_LENGTH = 32

/**
 * A per-process capability for the loopback API.  Tokens are intentionally
 * opaque: callers must only send them in an Authorization header.
 */
export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * The desktop supervisor generates this value and injects it through the
 * child's environment.  A direct standalone launch creates its own token.
 * Never include the token in an exception: stderr is collected by the
 * supervisor and may be retained for diagnostics.
 */
export function resolveSessionToken(injectedToken: string | undefined): string {
  if (injectedToken === undefined) return createSessionToken()
  if (injectedToken.length < MINIMUM_TOKEN_LENGTH || /[\r\n]/.test(injectedToken)) {
    throw new Error('MEGA_BRAIN_SESSION_TOKEN inválido')
  }
  return injectedToken
}

/** Uses constant-time comparison after validating the exact Bearer scheme. */
export function hasValidBearerToken(authorization: string | undefined, expectedToken: string): boolean {
  const prefix = 'Bearer '
  if (!authorization?.startsWith(prefix)) return false
  const supplied = Buffer.from(authorization.slice(prefix.length), 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
