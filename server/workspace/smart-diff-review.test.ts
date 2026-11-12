import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import type { ProcessChild, ProcessRunner } from '../process'
import { createWorkspaceService } from './service'
import { reviewPrompt } from './smart-diff-review'
import type { AgentSession } from '../../shared/domain/agents'
import type { listBoardCards } from './board-list'
import { completeWorkspaceConfig } from './workspace-config'
import { writeStageSettings } from './stage-settings'

afterEach(() => vi.unstubAllEnvs())

test('converts the old skill wording in saved Smart Diff prompts', () => {
  const legacy =
    'Esta skill faz só o que não pode ser determinístico, e o script `review.mjs` (na pasta desta skill; o diretório base vem no prompt de invocação, senão `~/.claude/skills/smart-diff-review/`) valida e monta o resultado.\nnode "<dir-da-skill>/review.mjs" prepare'
  const prompt = reviewPrompt('/card', [], legacy, '/app/smart-diff-review-cli.mjs')
  expect(prompt).toContain('O script de revisão incluído no Mega Brain valida e monta o resultado.')
  expect(prompt).toContain('node "/app/smart-diff-review-cli.mjs" prepare')
  expect(prompt).not.toMatch(/\.claude\/skills|dir-da-skill|Esta skill/)
})

test.each(['claude', 'chatgpt'] as const)('opening diff uses the configured %s model, reviews the report, and saves diff.json', async (provider) => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-smart-diff-'))
  const card = join(root, 'card')
  const repo = join(root, 'repo')
  mkdirSync(card)
  mkdirSync(repo)
  const smartDiffRoot = join(root, 'smart-diff')
  const smartDiffBin = join(smartDiffRoot, 'packages', 'cli', 'bin')
  mkdirSync(smartDiffBin, { recursive: true })
  writeFileSync(join(smartDiffBin, 'smart-diff.cjs'), '')
  vi.stubEnv('SMART_DIFF_DIR', smartDiffRoot)
  writeFileSync(join(repo, '.git'), 'gitdir: /fixture/.git/worktrees/card')
  symlinkSync(repo, join(card, 'api'), process.platform === 'win32' ? 'junction' : 'dir')
  const calls: { smartDiff: string[][]; agent: string[][] } = { smartDiff: [], agent: [] }
  const runner = {
    execFile(
      command: string,
      args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) {
      if (command === 'gh') return callback(null, 'main\n', '')
      if (command === 'git') return callback(null, '', '')
      calls.smartDiff.push([command, ...args])
      callback(null, JSON.stringify({ schemaVersion: 1, readingOrder: [] }), '')
    },
    spawn(command: string, args: readonly string[]) {
      calls.agent.push([command, ...args])
      const child = new EventEmitter() as ProcessChild
      queueMicrotask(() => {
        if (calls.agent.length === 1)
          writeFileSync(
            join(
              card,
              '.smart-diff-review',
              createHash('sha256').update('api').digest('hex').slice(0, 16),
              'review.md',
            ),
            '# Mudança no contrato\n\n```ts\nconst enabled = true\n```',
          )
        writeFileSync(
          join(
            card,
            '.smart-diff-review',
            createHash('sha256').update('api').digest('hex').slice(0, 16),
            'review.json',
          ),
          JSON.stringify({ schemaVersion: 2, sections: [], noise: [] }),
        )
        child.emit('close', 0)
      })
      return child
    },
  } as ProcessRunner
  const config = completeWorkspaceConfig({ workspaceDir: root, executables: {} })
  config.preferences.llmProvider = provider
  const model = provider === 'claude' ? 'sonnet' : 'gpt-6-luna'
  writeStageSettings(root, { 'smart-diff-review': { model, effort: 'high', fastMode: false } }, provider)
  const service = createWorkspaceService(config, runner)
  const query = new URLSearchParams({ name: 'card' })

  expect(await service.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({
    status: 'running',
    started: true,
  })
  expect(await service.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({
    status: 'running',
    started: true,
  })
  expect(await service.handle('/diff', 'GET', query, undefined)).toMatchObject({
    status: 'running',
    steps: expect.arrayContaining(['Rodando a ferramenta Smart Diff em api']),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(calls.smartDiff).toHaveLength(1)
  expect(calls.smartDiff[0]).toContain('FETCH_HEAD...HEAD')
  expect(calls.agent).toHaveLength(1)
  expect(calls.agent[0]).toContain(model)
  expect(calls.agent[0]).toContain(provider === 'claude' ? 'high' : 'model_reasoning_effort="high"')
  const prompt = calls.agent[0].join(' ')
  expect(prompt).toContain('O script de revisão incluído no Mega Brain valida e monta o resultado.')
  expect(prompt).toContain('smart-diff-review-cli.mjs')
  expect(prompt).not.toMatch(/\.claude\/skills|dir-da-skill|Esta skill/)
  expect(existsSync(join(card, 'diff.json'))).toBe(true)
  expect(JSON.parse(readFileSync(join(card, 'diff.json'), 'utf8'))).toMatchObject({
    schemaVersion: 1,
    repositories: [
      {
        name: 'api',
        review: { schemaVersion: 2 },
        explanation: '# Mudança no contrato\n\n```ts\nconst enabled = true\n```',
      },
    ],
  })
  expect(await service.handle('/diff', 'GET', query, undefined)).toMatchObject({ status: 'ready', started: true })
  expect(await service.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({ status: 'ready' })
  expect(calls.smartDiff).toHaveLength(1)
  expect(await service.handle('/diff', 'POST', query, { name: 'card', regenerate: true })).toMatchObject({
    status: 'running',
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(calls.smartDiff).toHaveLength(2)
  const regenerated = await service.handle('/diff', 'GET', query, undefined)
  expect(regenerated).toMatchObject({ status: 'ready', result: { repositories: [{ name: 'api' }] } })
  expect(
    (regenerated as { result: { repositories: { explanation?: string }[] } }).result.repositories[0].explanation,
  ).toBeUndefined()
  const restarted = createWorkspaceService({ workspaceDir: root, executables: {} }, runner)
  expect(await restarted.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({ status: 'ready' })
  expect(calls.smartDiff).toHaveLength(2)
})
test('completed reviews are read from disk without keeping a stale document or regenerating', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-smart-diff-cache-'))
  const card = join(root, 'card')
  mkdirSync(card)
  const runner = { spawn: vi.fn(), execFile: vi.fn() } as unknown as ProcessRunner
  const service = createWorkspaceService({ workspaceDir: root, executables: {} }, runner)
  const query = new URLSearchParams({ name: 'card' })
  await service.handle('/diff', 'POST', query, { name: 'card' })
  const document = JSON.parse(readFileSync(join(card, 'diff.json'), 'utf8'))
  document.generatedAt = '2026-10-09T00:00:00.000Z'
  writeFileSync(join(card, 'diff.json'), JSON.stringify(document))
  expect(await service.handle('/diff', 'GET', query, undefined)).toMatchObject({
    status: 'ready',
    result: { generatedAt: document.generatedAt },
  })
  expect(await service.handle('/diff', 'POST', query, { name: 'card' })).toMatchObject({ status: 'ready' })
  expect(runner.spawn).not.toHaveBeenCalled()
  expect(runner.execFile).not.toHaveBeenCalled()
})

test('includes existing Markdown explanations when reading reviews generated before they were embedded', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mega-brain-smart-diff-explanation-'))
  const card = join(root, 'card')
  const work = join(card, '.smart-diff-review', createHash('sha256').update('api').digest('hex').slice(0, 16))
  mkdirSync(work, { recursive: true })
  writeFileSync(join(work, 'review.md'), '# Explicação existente\n\nTexto com snippets.')
  const review = { schemaVersion: 2, sections: [], noise: [] }
  writeFileSync(
    join(card, 'diff.json'),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: '',
      repositories: [
        { name: 'api', review },
        { name: 'web', review },
      ],
    }),
  )
  const runner = { spawn: vi.fn(), execFile: vi.fn() } as unknown as ProcessRunner
  const service = createWorkspaceService({ workspaceDir: root, executables: {} }, runner)
  const result = await service.handle('/diff', 'GET', new URLSearchParams({ name: 'card' }), undefined)
  expect(result).toMatchObject({
    status: 'ready',
    result: {
      repositories: [
        { name: 'api', explanation: '# Explicação existente\n\nTexto com snippets.' },
        { name: 'web', explanation: undefined },
      ],
    },
  })
  expect(runner.spawn).not.toHaveBeenCalled()
})

test.each(['claude', 'chatgpt'] as const)(
  'publishes script steps and %s narration on the board and diff without tool calls or duplicate sessions',
  async (llmProvider) => {
    const root = mkdtempSync(join(tmpdir(), 'smart-diff-activity-'))
    const card = join(root, 'card')
    const repo = join(root, 'repo')
    const smartDiffRoot = join(root, 'smart-diff')
    const bin = join(smartDiffRoot, 'packages', 'cli', 'bin')
    mkdirSync(card)
    mkdirSync(repo)
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'smart-diff.cjs'), '')
    writeFileSync(join(card, 'card.json'), JSON.stringify({ title: 'Review', status: 'code-review' }))
    writeFileSync(join(repo, '.git'), 'gitdir: /fixture/.git/worktrees/card')
    symlinkSync(repo, join(card, 'api'), process.platform === 'win32' ? 'junction' : 'dir')
    vi.stubEnv('SMART_DIFF_DIR', smartDiffRoot)
    const provider = llmProvider === 'chatgpt' ? 'codex' : 'claude'
    const sessions: AgentSession[] = []
    let reportReady!: () => void
    let child!: ProcessChild
    const spawn = vi.fn<ProcessRunner['spawn']>(() => {
      child = new EventEmitter() as ProcessChild
      return child
    })
    const runner = {
      spawn,
      execFileSync: vi.fn(),
      execFile(_command, args, _options, callback) {
        if (args[0] === 'repo') return callback(null, 'main', '')
        if (args[0] === 'fetch') return callback(null, '', '')
        reportReady = () => callback(null, JSON.stringify({ schemaVersion: 1, readingOrder: [] }), '')
      },
    } as ProcessRunner
    const service = createWorkspaceService(
      {
        workspaceDir: root,
        executables: {},
        preferences: {
          llmProvider,
          settingsFile: join(root, 'settings.json'),
          editor: 'cursor',
          editorCommand: '',
          onboardingCompleted: true,
        },
      },
      runner,
      undefined,
      () => sessions,
    )
    const query = new URLSearchParams({ name: 'card' })
    await service.handle('/diff', 'POST', query, { name: 'card' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await service.handle('/diff', 'GET', query, undefined)).toMatchObject({
      activity: { execution: 'script', phase: 'Rodando a ferramenta Smart Diff em api' },
    })
    const board = async () =>
      ((await service.handle('/', 'GET', new URLSearchParams(), undefined)) as ReturnType<typeof listBoardCards>).find(
        (entry) => entry.name === 'card',
      )!
    expect(await board()).toMatchObject({ smartDiffRunning: true, smartDiffActivity: { execution: 'script' } })
    reportReady()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(spawn.mock.calls[0][1]).toEqual(
      expect.arrayContaining(provider === 'codex' ? ['--json'] : ['--output-format', 'stream-json', '--verbose']),
    )
    expect(await board()).toMatchObject({
      smartDiffActivity: { execution: 'agent', provider, phase: 'Rodando o agente de revisão' },
    })
    const work = join(card, '.smart-diff-review')
    const log = join(work, 'agent.log')
    const narration = 'Vou comparar o contrato com os consumidores antes de explicar os tradeoffs.'
    const events =
      provider === 'claude'
        ? [
            { type: 'system', session_id: 'review-session' },
            {
              type: 'assistant',
              message: {
                content: [
                  { type: 'text', text: narration },
                  { type: 'thinking', thinking: 'Privado' },
                ],
              },
            },
            {
              type: 'assistant',
              message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'segredo' } }] },
            },
          ]
        : [
            { type: 'thread.started', thread_id: 'review-session' },
            { type: 'item.completed', item: { type: 'agent_message', text: narration } },
            {
              type: 'item.completed',
              item: { type: 'command_execution', command: 'segredo', aggregated_output: 'Privado' },
            },
          ]
    appendFileSync(log, events.map((event) => JSON.stringify(event)).join('\n') + '\n{"incomplete":')
    sessions.push({
      id: 'review-session',
      provider,
      status: 'rodando',
      cardId: 'card',
      cwd: card,
      title: 'Smart Diff',
      startedAt: '',
      updatedAt: '',
      activity: 'Bash: segredo',
    })
    const diff = await service.handle('/diff', 'GET', query, undefined)
    expect(diff).toMatchObject({ activity: { provider, activity: narration, sessionId: 'review-session' } })
    expect(JSON.stringify(diff)).not.toMatch(/segredo|Privado/)
    expect(await board()).toMatchObject({ agents: [], smartDiffActivity: { activity: narration } })
    appendFileSync(
      log,
      '\n' + Array.from({ length: 2500 }, () => JSON.stringify({ type: 'tool_use', input: 'x'.repeat(80) })).join('\n'),
    )
    expect(await board()).toMatchObject({ smartDiffActivity: { activity: narration } })
    sessions.length = 0
    writeFileSync(
      join(work, createHash('sha256').update('api').digest('hex').slice(0, 16), 'review.json'),
      JSON.stringify({ schemaVersion: 2, sections: [], noise: [] }),
    )
    child.emit('close', 0)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await board()).toMatchObject({ smartDiffRunning: false })
    expect((await board()).smartDiffActivity).toBeUndefined()
  },
)
