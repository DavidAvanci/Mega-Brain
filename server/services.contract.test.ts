import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { jiraTransitionHttp } from './jira/http'
import { createJiraService } from './jira/service'
import type { ProcessChild, ProcessOwner, ProcessRunner } from './process'
import { createWorkspaceService, worktreeRepoInfo } from './workspace/service'

function gitRunner(commonGitDir: string): ProcessRunner & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    execFileSync(command, args) {
      calls.push([command, ...args])
      return `${commonGitDir}\n`
    },
  } as ProcessRunner & { calls: string[][] }
}

function cardWithWorktree(root: string, status = 'a-fazer') {
  const card = join(root, 'card')
  const worktree = join(root, '..', 'worktrees', 'card', 'repo')
  const itemWorktree = join(root, '..', 'worktrees', 'card', 'items', 'T1', 'repo')
  mkdirSync(card, { recursive: true })
  mkdirSync(worktree, { recursive: true })
  mkdirSync(itemWorktree, { recursive: true })
  writeFileSync(join(card, 'card.json'), JSON.stringify({ title: 'Card', status }))
  writeFileSync(join(worktree, '.git'), 'gitdir: /fixture/.git/worktrees/card')
  writeFileSync(join(itemWorktree, '.git'), 'gitdir: /fixture/.git/worktrees/card-item')
  symlinkSync(worktree, join(card, 'repo'), 'dir')
  return { card, worktree, itemWorktree }
}

test('workspace service creates and lists only inside a temporary root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-service-'))
  const service = createWorkspaceService({ workspaceDir: root, executables: {} })
  await expect(service.handle('/', 'POST', new URLSearchParams(), { title: 'Meu card' }))
    .resolves.toMatchObject({ folder: 'MB-001' })
  await expect(service.handle('/', 'GET', new URLSearchParams(), undefined))
    .resolves.toMatchObject([{ name: 'MB-001', title: 'Meu card' }])
})

test('workspace service opens only the requested project PR', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-pr-open-'))
  const card = join(root, 'card')
  const browser = join(root, 'browser-fixture')
  mkdirSync(card)
  writeFileSync(browser, '')
  writeFileSync(join(card, 'card.json'), JSON.stringify({
    title: 'Card',
    status: 'aguardando-deploy',
    prs: {
      master: {
        api: 'https://github.test/api/pull/1',
        web: 'https://github.test/web/pull/2',
      },
    },
  }))

  const calls: Array<{ command: string; args: readonly string[] }> = []
  const child = Object.assign(new EventEmitter(), { unref() {} }) as unknown as ProcessChild
  const runner = {
    spawn(command: string, args: readonly string[]) {
      calls.push({ command, args })
      return child
    },
  } as ProcessRunner
  const service = createWorkspaceService({ workspaceDir: root, executables: { browser } }, runner)

  await expect(service.handle('/prs/open', 'POST', new URLSearchParams(), {
    name: 'card', env: 'master', project: 'web',
  })).resolves.toEqual({ ok: true })
  expect(calls).toEqual([{ command: browser, args: ['--new-window', 'https://github.test/web/pull/2'] }])

  await expect(service.handle('/prs/open', 'POST', new URLSearchParams(), {
    name: 'card', env: 'master', project: 'unknown',
  })).rejects.toThrow('Sem PR de master para unknown')
  expect(calls).toHaveLength(1)
})

test('workspace service opens a running dev environment in the configured browser', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-dev-env-open-'))
  const card = join(root, 'card')
  const browser = join(root, 'browser-fixture')
  mkdirSync(join(card, '.dev-env'), { recursive: true })
  writeFileSync(browser, '')
  writeFileSync(join(card, 'card.json'), JSON.stringify({ title: 'Card', status: 'code-review' }))
  writeFileSync(join(card, '.dev-env', 'state.json'), JSON.stringify({
    status: 'rodando',
    apps: [{ repo: 'web', kind: 'frontend', source: 'worktree', status: 'rodando', url: 'http://localhost:5180' }],
  }))

  const calls: Array<{ command: string; args: readonly string[] }> = []
  const child = Object.assign(new EventEmitter(), { unref() {} }) as unknown as ProcessChild
  const runner = {
    spawn(command: string, args: readonly string[]) {
      calls.push({ command, args })
      return child
    },
  } as ProcessRunner
  const service = createWorkspaceService({ workspaceDir: root, executables: { browser } }, runner)

  await expect(service.handle('/dev-env/open', 'POST', new URLSearchParams(), { name: 'card', repo: 'web' }))
    .resolves.toEqual({ ok: true })
  expect(calls).toEqual([{ command: browser, args: ['--new-window', 'http://localhost:5180'] }])

  await expect(service.handle('/dev-env/open', 'POST', new URLSearchParams(), { name: 'card', repo: 'api' }))
    .rejects.toThrow('Ambiente não está rodando: api')
})

test('automatic stage reset stops its owned process and restores the pre-run artifacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-reset-'))
  const card = join(root, 'card')
  mkdirSync(card)
  writeFileSync(join(card, 'card.json'), JSON.stringify({ title: 'Card', status: 'a-fazer', flow: 'medio' }))
  writeFileSync(join(card, 'PLAN.md'), '# Plano original\n')

  const rawChild = Object.assign(new EventEmitter(), {
    pid: process.pid,
    exitCode: null,
    killed: false,
    unref() {},
    kill() { rawChild.killed = true; rawChild.emit('exit', 0); return true },
  })
  const child = rawChild as unknown as ProcessChild
  const runner = { spawn: () => child } as unknown as ProcessRunner
  let stopped = false
  const owner: ProcessOwner = {
    own: (owned) => owned,
    stop: async (owned) => { stopped = true; owned.kill('SIGTERM') },
    shutdown: async () => {},
    size: 1,
  }
  const service = createWorkspaceService({ workspaceDir: root, executables: {} }, runner, owner)

  await service.handle('/update', 'POST', new URLSearchParams(), { name: 'card', status: 'planejando' })
  writeFileSync(join(card, 'PLAN.md'), '# Plano parcial da execução\n')
  writeFileSync(join(card, 'TASK-CHECKLIST.md'), '- [ ] T1 Parcial\n')

  await expect(service.handle('/stage/reset', 'POST', new URLSearchParams(), { name: 'card', stage: 'task-planning' }))
    .resolves.toEqual({ ok: true })
  expect(stopped).toBe(true)
  expect(readFileSync(join(card, 'PLAN.md'), 'utf8')).toBe('# Plano original\n')
  expect(existsSync(join(card, 'TASK-CHECKLIST.md'))).toBe(false)
  expect(existsSync(join(card, 'agent.json'))).toBe(false)
  expect(existsSync(join(card, 'task-planning.jsonl'))).toBe(false)
  expect(existsSync(join(card, 'task-planning.log'))).toBe(false)
})

test('script stages receive the configured Claude executable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-claude-'))
  const card = join(root, 'card')
  mkdirSync(card)
  writeFileSync(join(card, 'card.json'), JSON.stringify({ title: 'Card', status: 'code-review' }))
  let spawnedEnv: NodeJS.ProcessEnv | undefined
  const child = Object.assign(new EventEmitter(), { pid: 123, unref() {} }) as unknown as ProcessChild
  const runner = {
    spawn(_command, _args, options) { spawnedEnv = options?.env as NodeJS.ProcessEnv; return child },
  } as ProcessRunner
  const service = createWorkspaceService({
    workspaceDir: root,
    executables: { claude: '/fixture/bin/claude' },
  }, runner)

  await service.handle('/update', 'POST', new URLSearchParams(), { name: 'card', status: 'staging' })

  expect(spawnedEnv?.MEGA_BRAIN_CLAUDE_BIN).toBe('/fixture/bin/claude')
  expect(spawnedEnv?.MEGA_BRAIN_LLM_PROVIDER).toBe('claude')
})

test('ChatGPT stages forward the selected model and reasoning effort to Codex', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-stage-chatgpt-'))
  const card = join(root, 'card')
  mkdirSync(card)
  writeFileSync(join(card, 'card.json'), JSON.stringify({ title: 'Card', status: 'a-fazer', flow: 'simples' }))
  writeFileSync(join(root, '.mega-brain-settings.json'), JSON.stringify({
    stages: {
      'task-planning': { model: 'gpt-6-astra', effort: 'xhigh' },
    },
  }))
  const calls: Array<{ command: string; args: readonly string[] }> = []
  const child = Object.assign(new EventEmitter(), { pid: 123, unref() {} }) as unknown as ProcessChild
  const runner = {
    spawn(command: string, args: readonly string[]) { calls.push({ command, args }); return child },
  } as ProcessRunner
  const service = createWorkspaceService({
    workspaceDir: root,
    worktreesDir: join(root, '..', 'worktrees'),
    executables: { codex: '/fixture/bin/codex' },
    preferences: {
      settingsFile: join(root, '.global-settings.json'),
      editor: 'cursor',
      editorCommand: '',
      llmProvider: 'chatgpt',
      onboardingCompleted: true,
    },
  }, runner)

  await service.handle('/update', 'POST', new URLSearchParams(), { name: 'card', status: 'planejando' })

  expect(calls[0]?.command).toBe('/fixture/bin/codex')
  expect(calls[0]?.args).toContain('--model')
  expect(calls[0]?.args).toContain('gpt-6-astra')
  expect(calls[0]?.args).toContain('model_reasoning_effort="xhigh"')
})

test('worktree metadata identifies repository, branch, base version and current version', () => {
  const baseHash = '1111111111111111111111111111111111111111'
  const headHash = '2222222222222222222222222222222222222222'
  const outputs: Record<string, string> = {
    'show -s --format=%H%x00%h%x00%s%x00%cI HEAD': `${[headHash, headHash.slice(0, 7), 'feature version', '2026-09-10T12:00:00Z'].join('\0')}\n`,
    'rev-parse --path-format=absolute --git-common-dir': '/repos/main/.git\n',
    'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
    'merge-base origin/main HEAD': `${baseHash}\n`,
    'remote get-url origin': 'git@example.com:team/example.git\n',
    'rev-parse --abbrev-ref HEAD': 'feature/card\n',
    'status --porcelain': '',
  }
  const runner = {
    execFileSync(_command: string, args: string[]) {
      const key = args.slice(2).join(' ')
      if (!(key in outputs)) throw new Error(`Unexpected Git call: ${key}`)
      return outputs[key]
    },
  } as ProcessRunner

  const info = worktreeRepoInfo({ name: 'example', path: '/worktrees/card/example' }, 'git-fixture', runner)

  expect(info).toMatchObject({
    name: 'example',
    path: '/worktrees/card/example',
    repository: '/repos/main',
    remote: 'git@example.com:team/example.git',
    branch: 'feature/card',
    dirty: false,
    base: { ref: 'origin/main', hash: baseHash, shortHash: baseHash.slice(0, 7), inferred: true },
    head: { subject: 'feature version' },
  })
  expect(info.head.hash).toBe(headHash)

  const recorded = worktreeRepoInfo(
    { name: 'example', path: '/worktrees/card/example' },
    'git-fixture',
    runner,
    { ref: 'release/2026.09', hash: baseHash, repository: '/repos/canonical', createdAt: '2026-09-10T11:00:00Z' },
  )
  expect(recorded.base).toEqual({
    ref: 'release/2026.09',
    hash: baseHash,
    shortHash: baseHash.slice(0, 7),
    inferred: false,
    createdAt: '2026-09-10T11:00:00Z',
  })
  expect(recorded.repository).toBe('/repos/canonical')
})

test('manual card deletion removes its managed worktrees through Git first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-delete-'))
  const { card, worktree, itemWorktree } = cardWithWorktree(root)
  const runner = gitRunner(join(root, 'main', '.git'))
  const service = createWorkspaceService({ workspaceDir: root, executables: { git: 'git-fixture' } }, runner)

  await expect(service.handle('/delete', 'POST', new URLSearchParams(), { name: 'card' })).resolves.toEqual({ ok: true })
  expect(existsSync(card)).toBe(false)
  expect(runner.calls).toEqual([
    ['git-fixture', '-c', 'core.quotePath=false', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    ['git-fixture', '-c', 'core.quotePath=false', 'worktree', 'remove', '--force', worktree],
    ['git-fixture', '-c', 'core.quotePath=false', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    ['git-fixture', '-c', 'core.quotePath=false', 'worktree', 'remove', '--force', itemWorktree],
    ['git-fixture', '-c', 'core.quotePath=false', 'worktree', 'prune'],
  ])
})

test('automatic production cleanup removes linked worktrees too', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-expire-'))
  const { card, worktree } = cardWithWorktree(root, 'producao')
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
  utimesSync(join(card, 'card.json'), old, old)
  const runner = gitRunner(join(root, 'main', '.git'))
  const service = createWorkspaceService({ workspaceDir: root, executables: { git: 'git-fixture' } }, runner)

  await expect(service.handle('/', 'GET', new URLSearchParams(), undefined)).resolves.toEqual([])
  expect(existsSync(card)).toBe(false)
  expect(runner.calls).toContainEqual(['git-fixture', '-c', 'core.quotePath=false', 'worktree', 'remove', '--force', worktree])
})

test('automatic cleanup removes a managed worktree whose Git registration was pruned', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-orphan-worktree-'))
  const { card, worktree } = cardWithWorktree(root, 'producao')
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
  utimesSync(join(card, 'card.json'), old, old)
  const runner = {
    execFileSync() { throw new Error('fatal: not a git repository') },
  } as unknown as ProcessRunner
  const service = createWorkspaceService({ workspaceDir: root, executables: { git: 'git-fixture' } }, runner)

  await expect(service.handle('/', 'GET', new URLSearchParams(), undefined)).resolves.toEqual([])
  expect(existsSync(worktree)).toBe(false)
  expect(existsSync(card)).toBe(false)
})

test('worktree cleanup still reports Git failures when its registration exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-registered-worktree-'))
  const { card, worktree } = cardWithWorktree(root)
  const registration = join(root, 'main', '.git', 'worktrees', 'card')
  mkdirSync(registration, { recursive: true })
  writeFileSync(join(worktree, '.git'), `gitdir: ${registration}\n`)
  const runner = {
    execFileSync() { throw new Error('Git indisponível') },
  } as unknown as ProcessRunner
  const service = createWorkspaceService({ workspaceDir: root, executables: { git: 'git-fixture' } }, runner)

  await expect(service.handle('/delete', 'POST', new URLSearchParams(), { name: 'card' }))
    .rejects.toThrow('Não foi possível remover a worktree repo: Git indisponível')
  expect(existsSync(worktree)).toBe(true)
  expect(existsSync(card)).toBe(true)
})

test('card deletion removes temporary item worktrees and their container', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-items-'))
  const { itemWorktree } = cardWithWorktree(root)
  const runner = gitRunner(join(root, 'main', '.git'))
  const service = createWorkspaceService({ workspaceDir: root, executables: { git: 'git-fixture' } }, runner)

  await service.handle('/delete', 'POST', new URLSearchParams(), { name: 'card' })
  expect(runner.calls).toContainEqual(['git-fixture', '-c', 'core.quotePath=false', 'worktree', 'remove', '--force', itemWorktree])
  expect(existsSync(itemWorktree)).toBe(false)
})

test('jira service has a testable transport and preserves disabled behavior', async () => {
  const disabled = createJiraService({})
  await expect(disabled.ready()).resolves.toEqual([])
  await expect(disabled.statuses('ABC-1')).resolves.toEqual({})
  await expect(disabled.transition('ABC-1', 'em desenvolvimento')).rejects.toThrow('Integração com Jira não configurada')
  await expect(jiraTransitionHttp(disabled)({
    method: 'POST',
    path: '/api/jira/transition',
    query: new URLSearchParams(),
    headers: {},
    body: { key: 'ABC-1', status: 'em desenvolvimento' },
  })).resolves.toMatchObject({
    status: 500,
    body: { error: 'Integração com Jira não configurada. Informe site, e-mail e token em Configurações.' },
  })
  const service = createJiraService({ site: 'example', email: 'a', token: 'b' }, async () => new Response(JSON.stringify({ fields: { status: { name: 'Ready' } } })))
  await expect(service.statuses('ABC-1,broken')).resolves.toEqual({ 'ABC-1': 'Ready' })
})
