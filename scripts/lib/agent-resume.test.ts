import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, test, vi } from 'vitest'
import { runClaudeItem } from './executor'
import { itemCheckpoint } from './agent-checkpoint'

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

test.each(['claude', 'chatgpt'])(
  'continues the saved %s item session after its executor was terminated',
  async (provider) => {
    const path = mkdtempSync(join(tmpdir(), 'mega-brain-item-resume-'))
    vi.stubEnv('MEGA_BRAIN_CARD_PATH', path)
    vi.stubEnv('MEGA_BRAIN_STAGE_RUN_ID', 'original-run')
    vi.stubEnv('MEGA_BRAIN_LLM_PROVIDER', provider)
    const fake = () =>
      Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      })
    const first = fake()
    const second = fake()
    vi.mocked(spawn)
      .mockReturnValueOnce(first as unknown as ChildProcess)
      .mockReturnValueOnce(second as unknown as ChildProcess)
    const options = {
      cwd: path,
      prompt: 'Item: T1 — Implementar contrato',
      model: 'default',
      effort: 'high',
      tools: 'Read,Edit',
      timeoutMs: 5000,
    }
    const interrupted = runClaudeItem(options)
    first.stdout.write(
      `${JSON.stringify(
        provider === 'chatgpt'
          ? { type: 'thread.started', thread_id: 'exact-session' }
          : { type: 'system', session_id: 'exact-session' },
      )}\n`,
    )
    first.emit('close', null, 'SIGTERM')
    await interrupted
    const checkpoint = itemCheckpoint(path, path, options.prompt)
    expect(checkpoint.read()?.sessionId).toBe('exact-session')
    vi.stubEnv('MEGA_BRAIN_RESUMING_STAGE', '1')
    const resumed = runClaudeItem(options)
    const args = vi.mocked(spawn).mock.calls[1][1]!
    expect(args).toContain('exact-session')
    expect(args).toContain(provider === 'chatgpt' ? 'resume' : '--resume')
    expect(args.join(' ')).toContain('Não repita itens concluídos')
    expect(args.join(' ')).toContain('Implementar contrato')
    second.stdout.write(
      `${JSON.stringify(
        provider === 'chatgpt'
          ? { type: 'item.completed', item: { type: 'agent_message', text: '{"status":"done","note":"Concluído"}' } }
          : { type: 'result', subtype: 'success', structured_output: { status: 'done', note: 'Concluído' } },
      )}\n`,
    )
    second.emit('close', 0)
    await expect(resumed).resolves.toMatchObject({ status: 'done' })
    expect(checkpoint.read()).toBeUndefined()
  },
)
