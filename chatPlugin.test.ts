import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { chatEvent, parseTranscript, resolveSession, sessionDir } from './server/chat/service'

test('sessionDir', () => {
  expect(sessionDir('/home/david/takeat/workspace/ESTR-426', '/projects')).toBe(
    '/projects/-home-david-takeat-workspace-ESTR-426',
  )
})

function transcriptFixture(projects: string, card: string, ids: string[]): void {
  const dir = join(projects, card.replace(/[/.]/g, '-'))
  mkdirSync(dir, { recursive: true })
  ids.forEach((id, index) => {
    const file = join(dir, `${id}.jsonl`)
    writeFileSync(file, '')
    utimesSync(file, index + 1, index + 1)
  })
}

test('resolveSession prefere a sessão do agente e cai na mais recente', () => {
  const projects = mkdtempSync(join(tmpdir(), 'projects-'))
  const card = mkdtempSync(join(tmpdir(), 'card-'))
  expect(resolveSession(card, projects)).toBeUndefined()

  transcriptFixture(projects, card, ['antiga', 'recente'])
  expect(resolveSession(card, projects)).toBe('recente')

  writeFileSync(join(card, 'agent.json'), JSON.stringify({ pid: 1, stage: 'task-planning' }))
  writeFileSync(join(card, 'task-planning.jsonl'), JSON.stringify({ session_id: 'antiga' }))
  expect(resolveSession(card, projects)).toBe('antiga')

  writeFileSync(join(card, 'task-planning.jsonl'), JSON.stringify({ session_id: 'apagada' }))
  expect(resolveSession(card, projects)).toBe('recente')
})

test('parseTranscript', () => {
  const lines = [
    '{quebrado',
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'ajusta o botão' } }),
    JSON.stringify({ type: 'user', message: { content: '<local-command-stdout>oi</local-command-stdout>' } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Feito.' },
        ],
      },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/App.tsx' } }] },
    }),
    JSON.stringify({
      type: 'assistant',
      isSidechain: true,
      message: { content: [{ type: 'text', text: 'de um subagente' }] },
    }),
  ]
  expect(parseTranscript(lines.join('\n'))).toEqual([
    { role: 'user', text: 'ajusta o botão' },
    { role: 'assistant', text: 'Feito.' },
    { role: 'assistant', tool: 'Edit: src/App.tsx' },
  ])
})

test('chatEvent', () => {
  const stream = (event: unknown) => JSON.stringify({ type: 'stream_event', event })
  expect(chatEvent('{quebrado')).toBeNull()
  expect(chatEvent(stream({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'oi' } }))).toEqual({
    type: 'text',
    text: 'oi',
  })
  expect(chatEvent(stream({ type: 'content_block_delta', delta: { type: 'input_json_delta' } }))).toBeNull()
  expect(chatEvent(stream({ type: 'message_stop' }))).toBeNull()
  expect(
    chatEvent(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] },
      }),
    ),
  ).toEqual({ type: 'tool', tool: 'Bash: ls' })
  expect(
    chatEvent(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'oi' }] } })),
  ).toBeNull()
  expect(chatEvent(JSON.stringify({ type: 'result', subtype: 'success' }))).toEqual({ type: 'done' })
  expect(chatEvent(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }))).toEqual({
    type: 'done',
    error: 'error_max_turns',
  })
})
