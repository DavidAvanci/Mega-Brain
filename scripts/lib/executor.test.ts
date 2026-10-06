import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, test, vi } from 'vitest'
import { claudeBin, runClaudeItem } from './executor'

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, spawn: vi.fn() }
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
