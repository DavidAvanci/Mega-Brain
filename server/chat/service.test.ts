import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseChatSettings, createChatService } from './service'
import type { ProcessOwner, ProcessRunner } from '../process'

function fakeRunner() {
  const children: (EventEmitter & Record<string, any>)[] = []
  const calls: { command: string; args: readonly string[] }[] = []
  const runner: ProcessRunner = {
    spawn(command, args) {
      calls.push({ command, args })
      const child = new EventEmitter() as EventEmitter & Record<string, any>
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = (signal: string) => {
        child.signalCode = signal
        child.emit('close', null, signal)
        return true
      }
      child.exitCode = null
      child.signalCode = null
      children.push(child)
      return child as any
    },
    execFileSync() {
      return ''
    },
    execFile(_command, _args, _options, callback) {
      callback(null, '', '')
    },
  }
  return { runner, children, calls }
}

function testConfig(root: string) {
  const card = join(root, 'card')
  mkdirSync(card, { recursive: true })
  return {
    workspaceDir: root,
    directories: {
      home: root,
      claudeHome: join(root, '.claude'),
      claudeProjects: join(root, 'projects'),
      claudeCredentials: join(root, '.claude', '.credentials.json'),
    },
    executables: { claude: 'claude-fixture' },
  }
}

function fakeOwner(killed: string[]): ProcessOwner {
  return {
    own: (child) => child,
    async stop(child) {
      child.kill('SIGTERM')
      killed.push('stopped')
    },
    async shutdown() {},
    get size() {
      return 0
    },
  }
}

test('reads model and effort from the latest assistant response', () => {
  const transcript = [
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5' }, effort: 'low' }),
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { model: 'claude-haiku-5' }, effort: 'high' }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5' }, effort: 'medium' }),
  ].join('\n')

  expect(parseChatSettings(transcript)).toEqual({ model: 'claude-opus-5', effort: 'medium' })
})

test('chat process tracking is per service instance and runtime shutdown stops only its registered child', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-chat-scope-'))
  const config = testConfig(root)
  const firstRunner = fakeRunner()
  const secondRunner = fakeRunner()
  const stopped: string[] = []
  const first = createChatService(config, firstRunner.runner, fakeOwner(stopped))
  const second = createChatService(config, secondRunner.runner)

  first.send('card', 'primeira sessão', () => {})
  second.send('card', 'segunda sessão independente', () => {})
  expect(firstRunner.children).toHaveLength(1)
  expect(secondRunner.children).toHaveLength(1)

  await first.shutdown?.()
  expect(stopped).toEqual(['stopped'])
  expect((firstRunner.children[0] as any).signalCode).toBe('SIGTERM')
  expect((secondRunner.children[0] as any).signalCode).toBeNull()
})

test('new Claude text chats bypass permissions by default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-chat-default-'))
  const fake = fakeRunner()
  const service = createChatService(testConfig(root), fake.runner)
  service.send('card', 'continue', () => {})
  const args = fake.calls[0].args
  expect(args).toContain('--session-id')
  expect(args).toContain('--permission-mode')
  expect(args).toContain('bypassPermissions')
  await service.shutdown?.()
})

test('new Codex text chats bypass approvals and sandbox by default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-chat-codex-default-'))
  const config = {
    ...testConfig(root),
    preferences: {
      settingsFile: join(root, 'settings.json'),
      editor: 'cursor' as const,
      editorCommand: '',
      llmProvider: 'chatgpt' as const,
      onboardingCompleted: true,
    },
  }
  const fake = fakeRunner()
  const service = createChatService(config, fake.runner)
  service.send('card', 'oi', () => {})
  expect(fake.calls[0].args).toContain('--dangerously-bypass-approvals-and-sandbox')
  await service.shutdown?.()
})

test('chat sends validated repository context for registered mentions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-chat-mention-'))
  const checkout = join(root, 'repository')
  mkdirSync(join(checkout, '.git'), { recursive: true })
  writeFileSync(
    join(root, 'repositories.json'),
    JSON.stringify({
      version: 1,
      repositories: [{ id: 'repo_1', alias: 'api', displayName: 'API', path: checkout, active: true }],
    }),
  )
  const fake = fakeRunner()
  const service = createChatService(
    {
      ...testConfig(root),
      preferences: {
        settingsFile: join(root, 'settings.json'),
        editor: 'cursor',
        editorCommand: '',
        llmProvider: 'claude',
        onboardingCompleted: true,
      },
    },
    fake.runner,
  )
  service.send('card', 'Ajuste @api e ignore @unknown', () => {})
  const prompt = fake.calls[0].args[1]
  expect(prompt).toContain('"id":"repo_1"')
  expect(prompt).toContain(JSON.stringify({ id: 'repo_1', alias: 'api', path: checkout }))
  expect(prompt).toContain('@unknown')
  await service.shutdown?.()
})
