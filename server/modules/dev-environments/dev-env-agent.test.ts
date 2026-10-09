import { ChildProcess, type SpawnOptions } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { createChatService, chatEvent } from '../../chat/service'
import { appendConversation } from '../../chat/task-conversation'
import { loadMegaBrainConfig } from '../../config'
import { createProcessOwner, type ProcessRunner } from '../../process'
import { createDevEnvAgentService } from './dev-env-agent'
import type { ChatEvent } from '../../../shared/contracts/chat'

const roots: string[] = []
function fixture(provider: 'claude' | 'chatgpt' = 'claude') {
  const root = mkdtempSync(join(tmpdir(), 'mega-dev-env-agent-'))
  roots.push(root)
  const config = loadMegaBrainConfig({
    homeDir: root,
    env: { MEGA_BRAIN_WORKSPACE_DIR: join(root, 'workspace'), MEGA_BRAIN_SETTINGS_FILE: join(root, 'settings.json') },
  })
  config.preferences.llmProvider = provider
  config.workspaceDir = join(root, 'workspace')
  const path = join(config.workspaceDir, 'card')
  mkdirSync(path, { recursive: true })
  const children: ChildProcess[] = []
  const calls: { command: string; args: readonly string[]; options?: SpawnOptions }[] = []
  const runner: ProcessRunner = {
    spawn(command, args, options) {
      calls.push({ command, args, options })
      const child = new ChildProcess()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.kill = vi.fn((signal) => {
        Object.defineProperty(child, 'signalCode', {
          value: typeof signal === 'string' ? signal : 'SIGTERM',
          configurable: true,
        })
        child.emit('close', null, child.signalCode)
        return true
      })
      children.push(child)
      return child
    },
    execFileSync() {
      return ''
    },
    execFile(_command, _args, _options, callback) {
      callback(null, '', '')
    },
  }
  return { root, path, config, calls, children, runner }
}
function output(child: ChildProcess, value: unknown) {
  child.stdout?.emit('data', JSON.stringify(value) + '\n')
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test('terminal usa sessão própria, mostra comandos e saídas sem poluir o chat da tarefa', async () => {
  const fake = fixture()
  appendConversation(fake.path, { role: 'user', text: 'Conversa de implementação' })
  const busy = new Set<string>()
  const chat = createChatService(fake.config, fake.runner, undefined, { busyPaths: busy })
  const environment = createDevEnvAgentService(fake.config, fake.runner, createProcessOwner(), busy)
  const events: ChatEvent[] = []
  environment.send('card', 'Investigue a inicialização', (event) => events.push(event))
  expect(fake.calls[0].options?.cwd).toBe(fake.path)
  expect(fake.calls[0].args).toContain('--session-id')
  expect(fake.calls[0].args).not.toContain('--resume')
  expect(fake.calls[0].args.join(' ')).toContain('não use Docker sem a opção explícita')
  expect(fake.calls[0].args.join(' ')).not.toContain('Conversa de implementação')
  expect(readFileSync(fake.calls[0].options?.env?.MEGA_BRAIN_DEV_ENV_CLI ?? '', 'utf8')).toContain(
    '/api/dev-env-agent/control',
  )
  expect(() => chat.send('card', 'Continue', () => {})).toThrow('Já há um agente')
  output(fake.children[0], {
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Vou conferir a porta.' }] },
  })
  output(fake.children[0], {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'PORT=3333 node server.js' } }] },
  })
  output(fake.children[0], {
    type: 'user',
    message: { content: [{ type: 'tool_result', content: 'DB_PASSWORD=example-secret\nready' }] },
  })
  output(fake.children[0], { type: 'result', subtype: 'success' })
  fake.children[0].emit('close', 0)
  expect(events).toContainEqual({ type: 'tool', tool: 'PORT=3333 node server.js' })
  expect(events).toContainEqual({ type: 'output', text: 'DB_PASSWORD=[oculto]\nready' })
  const history = await environment.history('card')
  expect(history.executionRunning).toBe(false)
  expect(history.entries.map((entry) => entry.text ?? entry.tool ?? entry.output)).toEqual([
    'Investigue a inicialização',
    'Vou conferir a porta.',
    'PORT=3333 node server.js',
    'DB_PASSWORD=[oculto]\nready',
  ])
  expect((await chat.history('card')).entries).toHaveLength(1)
  expect(busy.size).toBe(0)
})

test('Codex transmite execução e histórico continua disponível após fechar o card', async () => {
  const fake = fixture('chatgpt')
  const owner = createProcessOwner()
  const busy = new Set<string>()
  const environment = createDevEnvAgentService(fake.config, fake.runner, owner, busy)
  const events: ChatEvent[] = []
  environment.send('card', 'Leia o log', (event) => events.push(event))
  output(fake.children[0], { type: 'item.started', item: { type: 'command_execution', command: 'cat api.log' } })
  output(fake.children[0], {
    type: 'item.completed',
    item: { type: 'command_execution', aggregated_output: 'token=example-token\nport busy' },
  })
  output(fake.children[0], { type: 'item.completed', item: { type: 'agent_message', text: 'A porta está em uso.' } })
  output(fake.children[0], { type: 'turn.completed' })
  fake.children[0].emit('close', 0)
  expect(events).toContainEqual({ type: 'output', text: 'token=[oculto]\nport busy' })
  const reopened = createDevEnvAgentService(fake.config, fake.runner, owner, busy)
  expect((await reopened.history('card')).entries.map((entry) => entry.text ?? entry.tool ?? entry.output)).toEqual([
    'Leia o log',
    'cat api.log',
    'token=[oculto]\nport busy',
    'A porta está em uso.',
  ])
})

test('interromper terminal cancela seu processo e libera o card para outro agente', async () => {
  const fake = fixture()
  const owner = createProcessOwner()
  const busy = new Set<string>()
  const environment = createDevEnvAgentService(fake.config, fake.runner, owner, busy)
  environment.send('card', 'Inicie', () => {})
  expect((await environment.history('card')).executionRunning).toBe(true)
  expect(fake.calls[0].options?.detached).toBe(process.platform !== 'win32')
  environment.abort('card')
  expect(fake.children[0].kill).toHaveBeenCalledWith('SIGTERM')
  expect(busy.size).toBe(0)
  expect((await environment.history('card')).executionRunning).toBe(false)
})

test('texto parcial de Claude não expõe credenciais divididas entre eventos', () => {
  expect(
    chatEvent(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'TOKEN=example' } },
      }),
      true,
    ),
  ).toBeNull()
})
