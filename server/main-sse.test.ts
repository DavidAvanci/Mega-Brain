import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { request as nodeRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { chatAbortHttp, chatSendHttp } from './chat/http'
import { createChatService } from './chat/service'
import { loadMegaBrainConfig } from './config'
import { createStandaloneServer, type StandaloneServer } from './main'
import type { ProcessRunner } from './process'
import { createServerRuntime } from './runtime'

class FakeClaudeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kills: string[] = []
  kill(signal?: NodeJS.Signals): boolean {
    this.kills.push(signal ?? 'SIGTERM')
    queueMicrotask(() => this.emit('close', null, signal ?? 'SIGTERM'))
    return true
  }
}

function chatFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-sse-'))
  mkdirSync(join(root, 'card'))
  let child: FakeClaudeChild | undefined
  const runner: ProcessRunner = {
    spawn: () => (child = new FakeClaudeChild()) as any,
    execFileSync: () => '',
    execFile: (_command, _args, _options, callback) => callback(null, '', ''),
  }
  const service = createChatService(
    {
      workspaceDir: root,
      directories: {
        home: root,
        claudeHome: join(root, '.claude'),
        claudeProjects: join(root, 'projects'),
        claudeCredentials: join(root, '.claude', '.credentials.json'),
      },
      executables: { claude: 'claude-fake' },
    },
    runner,
  )
  const runtime = createServerRuntime()
  runtime.register('POST', '/api/chat/send', chatSendHttp(service))
  runtime.register('POST', '/api/chat/abort', chatAbortHttp(service))
  return {
    runtime,
    get child() {
      return child
    },
  }
}

describe('standalone chat SSE', () => {
  const servers: StandaloneServer[] = []
  const token = 't'.repeat(43)

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()))
    servers.length = 0
  })

  async function start() {
    const fixture = chatFixture()
    const server = createStandaloneServer({
      config: loadMegaBrainConfig({ env: {}, homeDir: '/tmp/mega-brain-sse-test' }),
      runtime: fixture.runtime,
      listen: { port: 0 },
      sessionToken: token,
    })
    servers.push(server)
    await server.start()
    return { fixture, base: `http://127.0.0.1:${server.address().port}` }
  }

  test('frames and flushes separate SSE chunks before the chat finishes, including a final error', async () => {
    const { base, fixture } = await start()
    const response = await fetch(`${base}/api/chat/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'card', text: 'oi' }),
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    expect(response.headers.get('connection')).toBe('keep-alive')
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    fixture.child!.stdout.emit(
      'data',
      Buffer.from(
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"um"}}}\n',
      ),
    )
    expect((await reader.read()).value).toBe('data: {"type":"text","text":"um"}\n\n')
    fixture.child!.stdout.emit(
      'data',
      Buffer.from(
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"dois"}}}\n',
      ),
    )
    expect((await reader.read()).value).toBe('data: {"type":"text","text":"dois"}\n\n')
    fixture.child!.stdout.emit(
      'data',
      Buffer.from('{"type":"result","subtype":"error","is_error":true,"result":"falha fake"}\n'),
    )
    expect((await reader.read()).value).toBe('data: {"type":"done","error":"falha fake"}\n\n')
    expect((await reader.read()).done).toBe(true)
  })

  test('explicit abort kills the fake child and ends the SSE without an orphan', async () => {
    const { base, fixture } = await start()
    const stream = await fetch(`${base}/api/chat/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'card', text: 'oi' }),
    })
    const abort = await fetch(`${base}/api/chat/abort`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'card' }),
    })
    expect(await abort.json()).toEqual({ ok: true })
    expect(fixture.child!.kills).toEqual(['SIGTERM'])
    const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader()
    expect((await reader.read()).value).toBe('data: {"type":"done","error":"Interrompido"}\n\n')
    expect((await reader.read()).done).toBe(true)
  })

  test('a disconnected client cancels the fake child and does not attempt further SSE writes', async () => {
    const { base, fixture } = await start()
    await new Promise<void>((resolve, reject) => {
      const req = nodeRequest(
        `${base}/api/chat/send`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
        (response) => {
          response.once('data', () => undefined)
        },
      )
      req.once('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? resolve() : reject(error)))
      req.end(JSON.stringify({ name: 'card', text: 'oi' }))
      setTimeout(() => {
        req.destroy()
        resolve()
      }, 20)
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fixture.child!.kills).toEqual(['SIGTERM'])
    fixture.child!.stdout.emit(
      'data',
      Buffer.from(
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"ignored"}}}\n',
      ),
    )
  })
})
