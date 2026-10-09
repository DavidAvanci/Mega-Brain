import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseChatSettings, createChatService } from './service'
import { appendConversation } from './task-conversation'
import { AGENT_FILE } from '../workspace/stage-agent'
import { createWorkspaceService } from '../workspace/service'
import { createAgentSessionService } from '../agents/service'
import type { ProcessOwner, ProcessRunner } from '../process'
import type { SpawnOptions } from 'node:child_process'
import { createCodexProfilesStore } from '../codex-profiles/service'

function fakeRunner() {
  const children: (EventEmitter & Record<string, any>)[] = []
  const calls: { command: string; args: readonly string[]; options?: SpawnOptions }[] = []
  const runner: ProcessRunner = {
    spawn(command, args, options) {
      calls.push({ command, args, options })
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

test('mensagem durante execução entra na conversa sem iniciar outro agente', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-chat-task-'))
  const config = testConfig(root)
  const path = join(root, 'card')
  writeFileSync(join(path, AGENT_FILE), JSON.stringify({ pid: process.pid, stage: 'run-task-checklist' }))
  appendConversation(path, { role: 'assistant', text: 'Implementando BE1', source: 'BE1' })
  const fake = fakeRunner()
  const service = createChatService(config, fake.runner)
  const events: unknown[] = []
  service.send('card', 'Acrescente a documentação', (event) => events.push(event))
  expect(fake.calls).toHaveLength(0)
  expect(events).toEqual([{ type: 'queued' }, { type: 'done' }])
  const history = await service.history('card')
  expect(history.executionRunning).toBe(true)
  expect(history.pendingMessages).toBe(1)
  expect(history.entries).toContainEqual({ role: 'user', text: 'Acrescente a documentação', queued: true })
})

test('chat Codex mantém respostas e contexto após recriar o serviço', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-chat-codex-history-'))
  const config = {
    ...testConfig(root),
    preferences: {
      settingsFile: join(root, 'settings.json'),
      editor: 'cursor' as const,
      editorCommand: 'cursor',
      llmProvider: 'chatgpt' as const,
      onboardingCompleted: true,
    },
  }
  const fake = fakeRunner()
  const service = createChatService(config, fake.runner)
  service.send('card', 'O que mudou?', () => {})
  fake.children[0].stdout.emit(
    'data',
    `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Atualizei a API' } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`,
  )
  fake.children[0].emit('close', 0)
  const next = createChatService(config, fake.runner)
  expect((await next.history('card')).entries.map((entry) => entry.text)).toEqual(['O que mudou?', 'Atualizei a API'])
  next.send('card', 'E a documentação?', () => {})
  expect(fake.calls[1].args.join(' ')).toContain('Atualizei a API')
  await next.shutdown?.()
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

test('Codex chat applies the active profile to later launches while preserving running child routing and history labels', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-chat-profile-routing-'))
  const settingsFile = join(root, 'settings.json')
  const profiles = [
    { id: 'personal', name: 'Pessoal', home: join(root, '.codex-personal'), color: '#7dd3fc' },
    { id: 'work', name: 'Trabalho', home: join(root, '.codex-work'), color: '#a78bfa' },
  ]
  const store = createCodexProfilesStore(settingsFile, { homeDir: root, env: {} })
  store.write({ profiles, activeId: 'personal' })
  const config = {
    ...testConfig(root),
    preferences: {
      settingsFile,
      editor: 'cursor' as const,
      editorCommand: '',
      llmProvider: 'chatgpt' as const,
      onboardingCompleted: true,
    },
  }
  const fake = fakeRunner()
  const service = createChatService(config, fake.runner)
  service.send('card', 'Revise a implementação', () => {})
  const firstEnvironment = fake.calls[0].options?.env
  expect(firstEnvironment).toMatchObject({
    CODEX_HOME: profiles[0].home,
    MEGA_BRAIN_CODEX_PROFILE_ID: 'personal',
    MEGA_BRAIN_CODEX_PROFILE_NAME: 'Pessoal',
  })
  // A live default change only affects new children, including a launch from the same service instance.
  store.write({ profiles, activeId: 'work' })
  expect(firstEnvironment?.CODEX_HOME).toBe(profiles[0].home)
  fake.children[0].stdout.emit(
    'data',
    `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Revisei a implementação' } })}\n${JSON.stringify({ type: 'turn.completed' })}\n`,
  )
  fake.children[0].emit('close', 0)
  expect((await service.history('card')).entries).toMatchObject([
    { role: 'user', text: 'Revise a implementação', source: 'Codex · Pessoal' },
    { role: 'assistant', text: 'Revisei a implementação', source: 'Codex · Pessoal' },
  ])
  service.send('card', 'Agora revise os testes', () => {})
  expect(fake.calls[1].options?.env).toMatchObject({
    CODEX_HOME: profiles[1].home,
    MEGA_BRAIN_CODEX_PROFILE_ID: 'work',
    MEGA_BRAIN_CODEX_PROFILE_NAME: 'Trabalho',
  })
  expect(firstEnvironment?.CODEX_HOME).toBe(profiles[0].home)
  expect((await service.history('card')).entries.at(-1)).toMatchObject({
    role: 'user',
    text: 'Agora revise os testes',
    source: 'Codex · Trabalho',
  })
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

test.each(['claude', 'chatgpt'] as const)(
  'board shows a running %s card chat and clears it on exit',
  async (provider) => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-chat-card-'))
    const actualWorkspace = join(root, 'workspace')
    const workspaceAlias = join(root, 'workspace-alias')
    const config = {
      ...testConfig(actualWorkspace),
      workspaceDir: workspaceAlias,
      preferences: {
        settingsFile: join(root, 'settings.json'),
        editor: 'cursor' as const,
        editorCommand: '',
        llmProvider: provider,
        onboardingCompleted: true,
      },
    }
    symlinkSync(actualWorkspace, workspaceAlias, 'dir')
    const fake = fakeRunner()
    const chat = createChatService(config, fake.runner)
    let running = false
    const providerName = provider === 'chatgpt' ? 'codex' : 'claude'
    const agentService = createAgentSessionService({
      home: root,
      claudeProjects: join(root, 'projects'),
      workspaceDir: workspaceAlias,
      processes: () => (running ? [{ pid: 123, provider: providerName, cwd: join(actualWorkspace, 'card') }] : []),
    })
    const workspace = createWorkspaceService(
      { workspaceDir: workspaceAlias, executables: {} },
      fake.runner,
      undefined,
      () => agentService.list().sessions,
    )
    const board = async () =>
      (await workspace.handle('/', 'GET', new URLSearchParams(), undefined)) as Array<{
        agents: Array<{ status: string; provider?: string }>
      }>

    expect((await board())[0].agents).toEqual([])
    chat.send('card', 'oi', () => {})
    running = true
    expect(agentService.list().sessions[0]).toMatchObject({ cardId: 'card', provider: providerName, status: 'rodando' })
    expect((await board())[0].agents).toContainEqual({
      status: 'rodando',
      provider: providerName,
      sessionControlId: `${providerName}-123`,
      startedAt: expect.any(String),
      activity: undefined,
    })

    running = false
    fake.children[0].emit('close', 0, null)
    expect((await board())[0].agents).toEqual([])
    await chat.shutdown?.()
  },
)
