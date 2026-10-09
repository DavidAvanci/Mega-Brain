import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const secret = randomBytes(32)

export function devEnvCapability(card: string): string {
  const payload = Buffer.from(JSON.stringify({ card, expires: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

export function devEnvCapabilityCard(token: string | undefined): string | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', secret).update(payload).digest()
  const supplied = Buffer.from(signature, 'base64url')
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof value.card === 'string' && value.expires > Date.now() ? value.card : null
  } catch {
    return null
  }
}
