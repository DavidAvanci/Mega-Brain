import { describe, expect, test } from 'vitest'
import { createJsonlLogger } from './logger'
import { createStandaloneServer, type StandaloneServer } from './main'
import { loadMegaBrainConfig } from './config'
import type { ServerRuntime } from './runtime'

describe('structured backend logging', () => {
  test('redacts nested secrets, errors, URLs and headers before the sink receives JSONL', () => {
    const lines: string[] = []
    const logger = createJsonlLogger({ write: (line) => lines.push(line) }, 'session-safe-123456', () => new Date('2026-09-02T00:00:00.000Z'))
    const canaries = ['session-token-canary', 'jira-email@example.test', 'jira-token-canary', 'full prompt canary', 'file-content-canary']
    const nested = new Error(`file-content-canary ${canaries[0]}`, { cause: new Error('full prompt canary') })
    logger.event('test.failure', {
      token: canaries[0], jiraEmail: canaries[1], jiraToken: canaries[2], prompt: canaries[3],
      fileContent: canaries[4], headers: { authorization: `Bearer ${canaries[0]}` },
      url: `http://user:${canaries[2]}@localhost/x?prompt=${canaries[3]}`,
      nested: { error: nested, content: canaries[4] }, error: nested,
    })
    expect(lines).toHaveLength(1)
    const output = lines.join('')
    for (const canary of canaries) expect(output).not.toContain(canary)
    expect(JSON.parse(lines[0])).toMatchObject({ schemaVersion: 1, event: 'test.failure', sessionId: 'session-safe-123456' })
  })

  test('keeps crash-like diagnostic objects metadata-only, including Error causes and codes', () => {
    const lines: string[] = []
    const canaries = ['crash-token-canary', 'crash-prompt-canary', 'crash-file-canary']
    const error = Object.assign(new Error(`${canaries[0]} ${canaries[1]}`, {
      cause: new Error(canaries[2]),
    }), { code: 'E_CRASH_TEST' })
    const logger = createJsonlLogger({ write: (line) => lines.push(line) }, 'session-safe-123456')

    logger.event('backend.crash-like', {
      error,
      diagnostic: { stack: error.stack, message: error.message, cause: error.cause, token: canaries[0] },
      values: [error, { content: canaries[2] }],
    })

    const output = lines.join('')
    for (const canary of canaries) expect(output).not.toContain(canary)
    expect(JSON.parse(lines[0])).toMatchObject({
      event: 'backend.crash-like',
      error: { name: 'Error', code: 'E_CRASH_TEST' },
      diagnostic: { stack: '[redacted]', message: '[redacted]', cause: { name: 'Error' } },
      values: [{ name: 'Error', code: 'E_CRASH_TEST' }, { content: '[redacted]' }],
    })
  })

  test('logs request correlation and failures without query, auth header, or nested error text', async () => {
    const lines: string[] = []
    const token = 'request-token-canary-xxxxxxxxxxxxxxxxxxxxxxxx'
    const jiraEmail = 'jira-email@example.test'
    const prompt = 'complete prompt canary'
    const fileContent = 'file content canary'
    const logger = createJsonlLogger({ write: (line) => lines.push(line) }, 'session-safe-123456')
    const runtime: ServerRuntime = {
      register: () => undefined,
      handle: async () => { throw new Error(`${prompt} ${fileContent}`, { cause: new Error(jiraEmail) }) },
    }
    const server: StandaloneServer = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-log-test' }), runtime, listen: { port: 0 }, sessionToken: token, logger,
    })
    try {
      await server.start()
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/workspace?prompt=${encodeURIComponent(prompt)}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Jira-Email': jiraEmail },
      })
      expect(response.status).toBe(400)
      const output = lines.join('')
      for (const canary of [token, jiraEmail, prompt, fileContent]) expect(output).not.toContain(canary)
      const records = lines.map((line) => JSON.parse(line))
      expect(records).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'http.error', sessionId: 'session-safe-123456', route: '/api/workspace' }),
        expect.objectContaining({ event: 'http.request', sessionId: 'session-safe-123456', status: 400 }),
      ]))
      expect(records.find((record) => record.event === 'http.request').requestId).toMatch(/^[A-Za-z0-9_-]+$/)
    } finally { await server.stop() }
  })
})
