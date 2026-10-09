import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, test, vi } from 'vitest'
import { claudeBin, runClaudeItem } from './executor'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendConversation, pendingTaskMessages, taskConversation } from '../../server/chat/task-conversation'

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, spawn: vi.fn(original.spawn) }
})

const originalClaudeBin = process.env.MEGA_BRAIN_CLAUDE_BIN
const originalProvider = process.env.MEGA_BRAIN_LLM_PROVIDER
const originalCardPath = process.env.MEGA_BRAIN_CARD_PATH

afterEach(() => {
  if (originalClaudeBin === undefined) delete process.env.MEGA_BRAIN_CLAUDE_BIN
  else process.env.MEGA_BRAIN_CLAUDE_BIN = originalClaudeBin
  if (originalProvider === undefined) delete process.env.MEGA_BRAIN_LLM_PROVIDER
  else process.env.MEGA_BRAIN_LLM_PROVIDER = originalProvider
  if (originalCardPath === undefined) delete process.env.MEGA_BRAIN_CARD_PATH
  else process.env.MEGA_BRAIN_CARD_PATH = originalCardPath
  vi.clearAllMocks()
})

test('executes Claude without a turn limit and accepts its structured result', async () => {
  process.env.MEGA_BRAIN_LLM_PROVIDER = 'claude'
  delete process.env.MEGA_BRAIN_CARD_PATH
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  })
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess)

  const pending = runClaudeItem({
    cwd: process.cwd(),
    prompt: 'Item: T1 Implementar alteração',
    model: 'sonnet',
    tools: 'Read,Edit,Bash',
    timeoutMs: 60_000,
  })
  const args = vi.mocked(spawn).mock.calls[0][1] as string[]
  expect(args).not.toContain('--max-turns')
  child.stdout.write(JSON.stringify({ subtype: 'success', structured_output: { status: 'done', note: 'Concluído' } }))
  child.emit('close', 0)

  await expect(pending).resolves.toMatchObject({ status: 'done', note: 'Concluído' })
  expect(child.kill).not.toHaveBeenCalled()
})

test('claudeBin honors the executable propagated by the backend', () => {
  process.env.MEGA_BRAIN_CLAUDE_BIN = '  /fixture/bin/claude  '
  expect(claudeBin()).toBe('/fixture/bin/claude')
})

test.each(['claude', 'chatgpt'])('execução %s sem teto de turns recebe mensagens e revisa antes de finalizar', async provider => {
  const path = mkdtempSync(join(tmpdir(), 'task-live-chat-'))
  writeFileSync(join(path, 'card.json'), '{}')
  const binary = join(path, 'fake-agent')
  const calls = join(path, 'calls.jsonl')
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');
console.log(JSON.stringify(process.argv.includes('exec') ? {type:'item.completed',item:{type:'agent_message',text:'{"status":"done","note":"Implementado"}'}} : {type:'assistant',message:{content:[{type:'text',text:'Implementando'}]}}));
setTimeout(()=>{console.log(JSON.stringify(process.argv.includes('exec') ? {type:'turn.completed'} : {type:'result',subtype:'success',structured_output:{status:'done',note:'Implementado'},total_cost_usd:0.1}));},80);
`)
  chmodSync(binary, 0o755)
  const env = { MEGA_BRAIN_LLM_PROVIDER: provider, MEGA_BRAIN_CARD_PATH: path, MEGA_BRAIN_CARD_ID: 'card', MEGA_BRAIN_CLAUDE_BIN: binary, MEGA_BRAIN_CODEX_BIN: binary }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  try {
    const execution = runClaudeItem({ cwd: path, prompt: 'Item: T1 — implementar', model: 'default', tools: 'Read,Edit', timeoutMs: 5000 })
    const timer = setTimeout(() => appendConversation(path, { role: 'user', text: 'Inclua a documentação' }, true), 20)
    const result = await execution
    clearTimeout(timer)
    expect(result.status).toBe('done')
    const invocations: string[][] = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(invocations).toHaveLength(2)
    expect(invocations.flat()).not.toContain('--max-turns')
    expect(invocations[1].join(' ')).toContain('Inclua a documentação')
    expect(pendingTaskMessages(path)).toHaveLength(0)
    expect(taskConversation(path).some(entry => entry.role === 'assistant' && entry.text)).toBe(true)
    if (provider === 'claude') expect(result.costUsd).toBeCloseTo(0.2)
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})
