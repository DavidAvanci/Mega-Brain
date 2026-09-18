import { afterEach, describe, expect, test } from 'vitest'
import { createServer } from 'node:http'
import { createReleaseFixture } from './release-fixture'
import type { StandaloneServer } from './main'

describe('release hardening fixture', () => {
  const backends: StandaloneServer[] = []

  afterEach(async () => {
    await Promise.all(backends.map((backend) => backend.stop()))
    backends.length = 0
  })

  test('isolates concurrent loopback sessions with dynamic ports and per-session capabilities', async () => {
    const firstToken = 'a'.repeat(43)
    const secondToken = 'b'.repeat(43)
    const first = createReleaseFixture({ token: firstToken })
    const second = createReleaseFixture({ token: secondToken })
    backends.push(first, second)
    await Promise.all([first.start(), second.start()])

    expect(first.address().address).toBe('127.0.0.1')
    expect(second.address().address).toBe('127.0.0.1')
    expect(first.address().port).not.toBe(second.address().port)

    const firstUrl = `http://127.0.0.1:${first.address().port}/release-fixture`
    expect((await fetch(firstUrl, { headers: { Authorization: `Bearer ${firstToken}` } })).status).toBe(200)
    // A capability leaked from another desktop launch must not authorize it.
    expect((await fetch(firstUrl, { headers: { Authorization: `Bearer ${secondToken}` } })).status).toBe(401)
    expect((await fetch(firstUrl)).status).toBe(401)

    // A page served locally is still a different security principal.  Browsers
    // will enforce the missing CORS permission too, but assert the HTTP
    // boundary directly so this remains meaningful outside a WebView.
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const response = await fetch(firstUrl, {
        headers: { Authorization: `Bearer ${firstToken}`, Origin: origin },
      })
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      expect(await response.text()).not.toContain(firstToken)
    }
  })

  test('fails closed when the requested loopback port is occupied', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      blocker.listen({ host: '127.0.0.1', port: 0 }, () => {
        blocker.off('error', reject)
        resolve()
      })
    })
    const address = blocker.address()
    if (!address || typeof address === 'string') throw new Error('fixture did not allocate a TCP port')

    const backend = createReleaseFixture({ token: 'p'.repeat(43), port: address.port })
    try {
      await expect(backend.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
      expect(backend.httpServer.listening).toBe(false)
    } finally {
      await new Promise<void>((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()))
    }
  })
})
