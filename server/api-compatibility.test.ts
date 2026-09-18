import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { chatAbortHttp, chatHistoryHttp, chatSendHttp, formatSseEvent, SSE_HEADERS } from './chat/http'
import { claudeUsageHttp } from './claude-usage/http'
import { coffeeHttp } from './coffee/http'
import { legacyJsonError } from './contracts'
import { jiraReadyHttp, jiraStatusesHttp, jiraTransitionHttp } from './jira/http'
import { createWorkspaceService } from './workspace/service'
import { workspaceHttp } from './workspace/http'

const request = (method: string, path = '/', body?: unknown, query = new URLSearchParams()) => ({ method, path, body, query, headers: {} })

test('JSON adapters preserve the statuses, content type and body shapes used by the frontend', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'mega-brain-contract-'))
  const workspace = workspaceHttp(createWorkspaceService({ workspaceDir: workspaceRoot, executables: {} }))
  const chat = {
    history: async () => ({ sessionId: null, entries: [{ role: 'assistant' as const, text: 'Oi' }] }),
    abort: () => true,
    send: () => undefined,
  }
  const jira = {
    ready: async () => [{ key: 'MB-1', summary: 'Compatibilidade', description: '' }],
    statuses: async () => ({ 'MB-1': 'READY to do' }),
    transition: async () => ({ status: 'DESENVOLVIMENTO' }),
  }
  const usage = { getUsage: async () => ({ fiveHour: null, sevenDay: null, fable: null }) }
  const coffee = { start: () => undefined, stop: () => undefined, active: () => false }

  const responses = await Promise.all([
    workspace(request('GET')),
    workspace(request('POST', '/', { title: 'Card de teste' })),
    chatHistoryHttp(chat)(request('GET', '/', undefined, new URLSearchParams('name=MB-1'))),
    chatAbortHttp(chat)(request('POST', '/abort', { name: 'MB-1' })),
    jiraReadyHttp(jira)(request('GET')),
    jiraStatusesHttp(jira)(request('GET', '/statuses', undefined, new URLSearchParams('keys=MB-1'))),
    jiraTransitionHttp(jira)(request('POST', '/transition', { key: 'mb-1', status: 'DESENVOLVIMENTO' })),
    claudeUsageHttp(usage)(request('GET')),
    coffeeHttp(coffee)(request('POST')),
  ])
  ;(responses[1].body as { path: string }).path = '<temporary-workspace>/card-de-teste'
  expect(responses).toMatchInlineSnapshot(`
    [
      {
        "body": [],
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
      {
        "body": {
          "folder": "card-de-teste",
          "path": "<temporary-workspace>/card-de-teste",
        },
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
      {
        "body": {
          "entries": [
            {
              "role": "assistant",
              "text": "Oi",
            },
          ],
          "sessionId": null,
        },
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
      {
        "body": {
          "ok": true,
        },
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
      {
        "body": [
          {
            "description": "",
            "key": "MB-1",
            "summary": "Compatibilidade",
          },
        ],
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
      {
        "body": {
          "MB-1": "READY to do",
        },
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
      {
        "body": {
          "status": "DESENVOLVIMENTO",
        },
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
      {
        "body": {
          "fable": null,
          "fiveHour": null,
          "sevenDay": null,
        },
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
      {
        "body": {
          "active": false,
        },
        "headers": {
          "Content-Type": "application/json",
        },
        "status": 200,
      },
    ]
  `)
})

test('legacy failures remain 500 JSON error envelopes for readJson()', () => {
  expect(legacyJsonError(new Error('Mensagem vazia'))).toMatchInlineSnapshot(`
    {
      "body": {
        "error": "Mensagem vazia",
      },
      "headers": {
        "Content-Type": "application/json",
      },
      "status": 500,
    }
  `)
})

test('chat SSE keeps the headers and data-plus-blank-line framing consumed by sendChat()', async () => {
  const events: unknown[] = []
  const send = chatSendHttp({
    history: async () => ({ sessionId: null, entries: [] }),
    abort: () => true,
    send: (_name, _text, emit) => { emit({ type: 'text', text: 'olá' }); emit({ type: 'tool', tool: 'Read: PLAN.md' }); emit({ type: 'done' }) },
  })
  const response = await send(request('POST', '/send', { name: 'MB-1', text: 'oi' }))
  response.stream((event) => events.push(event))
  expect({ status: response.status, headers: response.headers }).toMatchInlineSnapshot(`
    {
      "headers": {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Content-Type": "text/event-stream",
      },
      "status": 200,
    }
  `)
  expect(events.map((event: any) => formatSseEvent(event))).toEqual([
    'data: {"type":"text","text":"olá"}\n\n',
    'data: {"type":"tool","tool":"Read: PLAN.md"}\n\n',
    'data: {"type":"done"}\n\n',
  ])
  expect(response.headers).toEqual(SSE_HEADERS)
})
