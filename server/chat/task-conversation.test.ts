import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { appendConversation, executionEntries, pendingTaskMessages, taskConversation, taskMessageContext } from './task-conversation'

test('mensagens sobrevivem à recarga e só confirma entrega do snapshot enviado', () => {
  const path = mkdtempSync(join(tmpdir(), 'task-conversation-'))
  appendConversation(path, { role: 'user', text: 'Use pnpm' }, true, 'Use pnpm e leia a nota anexada')
  const snapshot = taskMessageContext(path)
  appendConversation(path, { role: 'user', text: 'Atualize a documentação' }, true)
  expect(taskConversation(path).every(entry => entry.queued)).toBe(true)
  expect(snapshot.prompt).toContain('leia a nota anexada')
  snapshot.acknowledge()
  expect(pendingTaskMessages(path)).toHaveLength(1)
  expect(taskConversation(path).map(entry => entry.queued)).toEqual([false, true])
  expect(taskMessageContext(path).prompt).toContain('Use pnpm')
})

test('normaliza eventos Codex e Claude, sem incluir reasoning e saídas de comandos', () => {
  expect(executionEntries(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Pronto' } }))).toEqual([{ role: 'assistant', text: 'Pronto' }])
  expect(executionEntries(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'privado' }, { type: 'text', text: 'Revisando' }, { type: 'tool_use', name: 'Read' }] } }))).toEqual([{ role: 'assistant', text: 'Revisando' }, { role: 'assistant', tool: 'Read' }])
  expect(executionEntries(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'privado' } }))).toEqual([])
})
