import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { cardIdFromWorktreeCwd, createAgentSessionService } from './service'
import type { CodexProfile } from '../../shared/domain/codex-profiles'

function jsonl(path: string, events: unknown[], modifiedAt = new Date('2026-09-20T12:00:00.000Z')) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, events.map((event) => JSON.stringify(event)).join('\n'))
  utimesSync(path, modifiedAt, modifiedAt)
}

describe('agent session service', () => {
  test('shows explicit Claude questions and returns to reading after user input without exposing private reasoning', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-agent-question-'))
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const file = join(root, '.claude', 'projects', 'project', 'claude.jsonl')
    const events: unknown[] = [
      { type: 'user', cwd, sessionId: 'claude', message: { content: 'Implemente a API' } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private-reasoning-canary' }] } },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'AskUserQuestion',
              input: { questions: [{ question: 'Qual banco devemos usar?' }] },
            },
          ],
        },
      },
    ]
    jsonl(file, events)
    const service = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      now: () => new Date('2026-09-20T12:01:00Z'),
      processes: () => [{ pid: 42, provider: 'claude', cwd }],
    })
    expect(service.list().sessions[0]).toMatchObject({
      status: 'aguardando',
      visualState: 'waiting',
      question: 'Qual banco devemos usar?',
    })
    events.push(
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'Postgres' }] } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'schema.ts' } }] },
      },
    )
    jsonl(file, events)
    const session = service.list().sessions[0]
    expect(session).toMatchObject({ status: 'rodando', visualState: 'reading', activity: 'Read: schema.ts' })
    expect(session.question).toBeUndefined()
    expect(JSON.stringify(session)).not.toContain('private-reasoning-canary')
  })

  test('distinguishes a completed Claude turn from a question and reports thinking without its contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-agent-states-'))
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const file = join(root, '.claude', 'projects', 'project', 'claude.jsonl')
    const events = [
      { type: 'user', cwd, sessionId: 'claude', message: { content: 'Implemente a API' } },
      {
        type: 'assistant',
        message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Implementei e validei a API.' }] },
      },
    ]
    jsonl(file, events)
    const service = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      now: () => new Date('2026-09-20T12:01:00Z'),
      processes: () => [{ pid: 42, provider: 'claude', cwd }],
    })
    expect(service.list().sessions[0]).toMatchObject({
      status: 'rodando',
      visualState: 'idle',
      activity: 'Turno concluído',
    })
    jsonl(file, [
      events[0],
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private-reasoning-canary' }] } },
    ])
    const session = service.list().sessions[0]
    expect(session.visualState).toBe('thinking')
    expect(JSON.stringify(session)).not.toContain('private-reasoning-canary')
  })

  test('detects Codex request_user_input, clears answered questions and expires stale waiting sessions', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-codex-question-'))
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const file = join(root, '.codex', 'sessions', '2026', '09', '20', 'codex.jsonl')
    const events: unknown[] = [
      { type: 'session_meta', payload: { id: 'codex', cwd } },
      { type: 'event_msg', payload: { type: 'task_started' } },
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'functions.request_user_input',
          call_id: 'question-call',
          arguments: JSON.stringify({ questions: [{ question: 'Qual formato prefere?' }] }),
        },
      },
    ]
    jsonl(file, events)
    let now = new Date('2026-09-20T12:01:00Z')
    const service = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      now: () => now,
      processes: () => [],
    })
    expect(service.list().sessions[0]).toMatchObject({
      status: 'aguardando',
      question: 'Qual formato prefere?',
      visualState: 'waiting',
    })
    now = new Date('2026-09-20T12:10:00Z')
    expect(service.list().sessions[0]).toMatchObject({ status: 'aguardando', question: 'Qual formato prefere?' })
    now = new Date('2026-09-21T12:00:01Z')
    expect(service.list().sessions[0]).toMatchObject({ status: 'concluido', visualState: 'complete' })
    expect(service.list().sessions[0].question).toBeUndefined()
    events.push({
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'question-call', output: 'Markdown' },
    })
    jsonl(file, events)
    now = new Date('2026-09-20T12:01:00Z')
    expect(service.list().sessions[0]).toMatchObject({ status: 'rodando', visualState: 'working' })
    expect(service.list().sessions[0].question).toBeUndefined()
  })

  test('keeps explicit pending input without a process for 24 hours and clears tool output, new turns and completion', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-codex-pending-'))
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const file = join(root, '.codex', 'sessions', '2026', '09', '20', 'codex.jsonl')
    const pending = [
      { type: 'session_meta', payload: { id: 'pending', cwd } },
      { type: 'event_msg', payload: { type: 'task_started' } },
      {
        type: 'event_msg',
        timestamp: '2026-09-20T12:00:00Z',
        payload: { type: 'request_user_input', questions: [{ question: 'Escolha o banco de dados.' }] },
      },
    ]
    let now = new Date('2026-09-20T18:00:00Z')
    const service = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      now: () => now,
      processes: () => [],
    })
    jsonl(file, pending)
    expect(service.list().sessions[0]).toMatchObject({ status: 'aguardando', question: 'Escolha o banco de dados.' })
    for (const resolved of [
      {
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'no-original-id', output: 'Postgres' },
      },
      { type: 'event_msg', payload: { type: 'task_started' } },
      { type: 'event_msg', payload: { type: 'task_complete' } },
    ]) {
      jsonl(file, [...pending, resolved])
      expect(service.list().sessions[0].status).not.toBe('aguardando')
      expect(service.list().sessions[0].question).toBeUndefined()
    }
    // Later background updates must not extend the original question's lifetime.
    jsonl(file, pending, new Date('2026-09-21T11:59:00Z'))
    now = new Date('2026-09-21T12:00:01Z')
    expect(service.list().sessions[0].status).toBe('concluido')
  })

  test('keeps ordinary assistant questions after a completed turn in the short freshness window', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-codex-text-question-'))
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const file = join(root, '.codex', 'sessions', '2026', '09', '20', 'codex.jsonl')
    jsonl(file, [
      { type: 'session_meta', payload: { id: 'text-question', cwd } },
      { type: 'event_msg', payload: { type: 'task_started' } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: 'Deseja mais alguma alteração?' }],
        },
      },
      { type: 'event_msg', payload: { type: 'task_complete' } },
    ])
    let now = new Date('2026-09-20T12:01:00Z')
    const service = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      now: () => now,
      processes: () => [],
    })
    expect(service.list().sessions[0]).toMatchObject({
      status: 'aguardando',
      question: 'Deseja mais alguma alteração?',
    })
    now = new Date('2026-09-20T12:10:00Z')
    expect(service.list().sessions[0].status).toBe('concluido')
    expect(service.list().sessions[0].question).toBeUndefined()
  })
  test('keeps a card association for a finished session started in the card folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-card-session-'))
    const workspaceDir = join(root, 'cards-link')
    const cwd = join(root, 'cards', 'MB-123')
    const codexHome = join(root, '.codex')
    mkdirSync(cwd, { recursive: true })
    symlinkSync(join(root, 'cards'), workspaceDir, 'dir')
    jsonl(join(codexHome, 'sessions', '2026', '09', '20', 'card.jsonl'), [
      { type: 'session_meta', payload: { id: 'card-session', cwd } },
      { type: 'event_msg', payload: { type: 'task_complete' } },
    ])
    const sessions = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      codexHomes: [codexHome],
      workspaceDir,
      now: () => new Date('2026-09-20T12:01:00.000Z'),
      processes: () => [],
    }).list().sessions
    expect(sessions[0]).toMatchObject({ id: 'card-session', cardId: 'MB-123', name: 'MB-123' })
  })

  test('extracts only the first card segment inside the real worktrees root', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-worktree-path-'))
    const worktreesDir = join(root, 'worktrees')
    const nested = join(worktreesDir, 'MB-123', 'items', 'T1', 'api')
    mkdirSync(nested, { recursive: true })
    expect(cardIdFromWorktreeCwd(nested, worktreesDir)).toBe('MB-123')
    expect(cardIdFromWorktreeCwd(join(worktreesDir, 'MB-12', 'repos', 'api'), worktreesDir)).toBe('MB-12')
    expect(cardIdFromWorktreeCwd(join(root, 'worktrees-other', 'MB-123'), worktreesDir)).toBeUndefined()
    expect(cardIdFromWorktreeCwd(worktreesDir, worktreesDir)).toBeUndefined()
  })

  test('associates nested active and historical worktrees only to existing cards', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-worktree-sessions-'))
    const workspaceDir = join(root, 'cards')
    const worktreesDir = join(root, 'worktrees')
    const codexHome = join(root, '.codex')
    for (const cardId of ['MB-12', 'MB-123']) mkdirSync(join(workspaceDir, cardId), { recursive: true })
    const activeCwd = join(worktreesDir, 'MB-123', 'repos', 'api')
    const historicalCwd = join(worktreesDir, 'MB-12', 'items', 'T1', 'api')
    const unknownCwd = join(worktreesDir, 'MB-999', 'repos', 'api')
    const outsideCwd = join(root, 'worktrees-other', 'MB-123', 'repos', 'api')
    const removedNestedCwd = join(worktreesDir, 'MB-12', 'items', 'removed', 'api')
    const escapedCwd = join(worktreesDir, 'MB-123', 'escaped', 'api')
    for (const cwd of [activeCwd, historicalCwd, unknownCwd, outsideCwd]) mkdirSync(cwd, { recursive: true })
    symlinkSync(join(root, 'worktrees-other'), join(worktreesDir, 'MB-123', 'escaped'))
    for (const [id, cwd] of [
      ['historical', historicalCwd],
      ['unknown', unknownCwd],
      ['outside', outsideCwd],
      ['removed', removedNestedCwd],
      ['escaped', escapedCwd],
    ]) {
      jsonl(join(codexHome, 'sessions', '2026', '09', '20', `${id}.jsonl`), [
        { type: 'session_meta', payload: { id, cwd } },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ])
    }
    const sessions = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      codexHomes: [codexHome],
      workspaceDir,
      worktreesDir,
      now: () => new Date('2026-09-20T12:01:00.000Z'),
      processes: () => [{ pid: 123, provider: 'claude', cwd: activeCwd }],
    }).list().sessions
    expect(sessions.find(({ pid }) => pid === 123)).toMatchObject({ cardId: 'MB-123' })
    expect(sessions.find(({ id }) => id === 'historical')).toMatchObject({ cardId: 'MB-12', pid: undefined })
    expect(sessions.find(({ id }) => id === 'unknown')?.cardId).toBeUndefined()
    expect(sessions.find(({ id }) => id === 'outside')?.cardId).toBeUndefined()
    expect(sessions.find(({ id }) => id === 'removed')).toMatchObject({ cardId: 'MB-12', pid: undefined })
    expect(sessions.find(({ id }) => id === 'escaped')?.cardId).toBeUndefined()
  })
  test('combines active Claude processes with recent Claude and Codex sessions', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-agents-'))
    const claudeProjects = join(root, '.claude', 'projects')
    const codexHome = join(root, '.codex')
    const workspaceDir = join(root, 'cards')
    const activeCwd = join(workspaceDir, 'MB-123', 'repo')
    const pastCwd = join(root, 'past-project')
    mkdirSync(activeCwd, { recursive: true })
    jsonl(join(claudeProjects, 'active', 'claude-active.jsonl'), [
      {
        type: 'queue-operation',
        operation: 'enqueue',
        content: 'Implemente a tela de agentes',
        timestamp: '2026-09-20T11:50:00.000Z',
        sessionId: 'claude-active',
      },
      {
        type: 'user',
        cwd: activeCwd,
        sessionId: 'claude-active',
        message: { content: 'Implemente a tela de agentes' },
      },
      {
        type: 'assistant',
        effort: 'high',
        message: {
          model: 'claude-sonnet-4-5',
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/App.tsx' } }],
        },
      },
    ])
    mkdirSync(join(root, '.claude', 'sessions'), { recursive: true })
    writeFileSync(
      join(root, '.claude', 'sessions', '4321.json'),
      JSON.stringify({ sessionId: 'claude-active', name: 'Implementar monitor de agentes' }),
    )
    jsonl(
      join(codexHome, 'sessions', '2026', '09', '20', 'rollout-past.jsonl'),
      [
        {
          type: 'session_meta',
          timestamp: '2026-09-19T10:00:00.000Z',
          payload: { id: 'codex-past', cwd: pastCwd },
        },
        { type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'medium' } },
        {
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Revise o dashboard' }] },
        },
        { type: 'event_msg', payload: { type: 'task_started' } },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ],
      new Date('2026-09-19T10:05:00.000Z'),
    )
    writeFileSync(
      join(codexHome, 'session_index.jsonl'),
      JSON.stringify({ id: 'codex-past', thread_name: 'Revisar dashboard antigo' }),
    )

    const result = createAgentSessionService({
      home: root,
      claudeProjects,
      codexHomes: [codexHome],
      workspaceDir,
      now: () => new Date('2026-09-20T12:01:00.000Z'),
      processes: () => [
        {
          pid: 4321,
          provider: 'claude',
          cwd: activeCwd,
          startedAt: '2026-09-20T11:49:00.000Z',
        },
      ],
    }).list()

    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0]).toMatchObject({
      id: 'claude-active',
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      effort: 'high',
      status: 'rodando',
      name: 'Implementar monitor de agentes',
      title: 'Implemente a tela de agentes',
      cwd: activeCwd,
      cardId: 'MB-123',
      activity: 'Read: src/App.tsx',
      pid: 4321,
    })
    expect(result.sessions[1]).toMatchObject({
      id: 'codex-past',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'medium',
      status: 'concluido',
      name: 'Revisar dashboard antigo',
      title: 'Revise o dashboard',
      cwd: pastCwd,
    })
  })

  test('recognizes a fresh open Codex turn and respects the history limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-codex-agents-'))
    const codexHome = join(root, '.codex')
    const currentFile = join(codexHome, 'sessions', '2026', '09', '20', 'rollout-current.jsonl')
    jsonl(
      currentFile,
      [
        {
          type: 'session_meta',
          timestamp: '2026-09-20T11:59:00.000Z',
          payload: { id: 'codex-current', cwd: join(root, 'current') },
        },
        {
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Crie uma feature' }] },
        },
        { type: 'event_msg', payload: { type: 'task_started' } },
      ],
      new Date('2026-09-20T12:00:30.000Z'),
    )
    jsonl(
      join(codexHome, 'archived_sessions', 'rollout-old.jsonl'),
      [
        {
          type: 'session_meta',
          timestamp: '2026-09-01T09:00:00.000Z',
          payload: { id: 'codex-old', cwd: join(root, 'old') },
        },
      ],
      new Date('2026-09-01T09:00:00.000Z'),
    )

    const result = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      codexHomes: [codexHome],
      historyLimit: 1,
      now: () => new Date('2026-09-20T12:01:00.000Z'),
      processes: () => [],
    }).list()

    expect(result.sessions).toEqual([
      expect.objectContaining({ id: 'codex-current', status: 'rodando', title: 'Crie uma feature' }),
    ])
  })

  test('hides the internal Codex resources session', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-internal-codex-'))
    const codexHome = join(root, '.codex')
    const resourcesFile = join(codexHome, 'sessions', '2026', '09', '20', 'rollout-resources.jsonl')
    jsonl(resourcesFile, [
      { type: 'session_meta', payload: { id: 'codex-resources', cwd: join(root, 'resources') } },
      { type: 'event_msg', payload: { type: 'task_started' } },
    ])
    writeFileSync(
      join(codexHome, 'session_index.jsonl'),
      JSON.stringify({ id: 'codex-resources', thread_name: 'resources' }),
    )

    const result = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      codexHomes: [codexHome],
      now: () => new Date('2026-09-20T12:01:00.000Z'),
      processes: () => [],
    }).list()

    expect(result.sessions).toEqual([])
  })

  test('keeps concurrent agents that share the same working directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-concurrent-agents-'))
    const cwd = join(root, 'shared-project')
    const result = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      now: () => new Date('2026-09-20T12:01:00.000Z'),
      processes: () => [
        { pid: 100, provider: 'claude', cwd },
        { pid: 101, provider: 'claude', cwd },
      ],
    }).list()

    expect(result.sessions.map(({ pid }) => pid).sort()).toEqual([100, 101])
  })

  test('stops only a process that still belongs to the requested active session', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-stop-agent-'))
    const running = [
      { pid: 100, provider: 'claude' as const, cwd: join(root, 'first') },
      { pid: 101, provider: 'codex' as const, cwd: join(root, 'second') },
    ]
    const stopped: number[] = []
    const service = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      processes: () => running,
      stopProcess: (pid) => stopped.push(pid),
    })

    service.stop('claude-100')

    expect(stopped).toEqual([100])
    expect(() => service.stop('sessão-inexistente')).toThrow('A sessão não possui um processo ativo')
  })

  test('keeps identical session IDs and names isolated by profile and applies edits immediately', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-multiple-codex-'))
    const cwd = join(root, 'shared-project')
    let profiles: CodexProfile[] = [
      { id: 'personal', name: 'Pessoal', home: join(root, '.codex-personal'), color: '#7dd3fc' },
      { id: 'work', name: 'Trabalho', home: join(root, '.codex-work'), color: '#a78bfa' },
    ]
    for (const profile of profiles) {
      jsonl(join(profile.home, 'sessions', '2026', '09', '20', 'same.jsonl'), [
        { type: 'session_meta', payload: { id: 'same-id', cwd } },
        { type: 'event_msg', payload: { type: 'task_started' } },
      ])
      writeFileSync(
        join(profile.home, 'session_index.jsonl'),
        JSON.stringify({ id: 'same-id', thread_name: `Task ${profile.name}` }),
      )
    }
    const stopped: number[] = []
    const personalHome = profiles[0].home
    const workHome = profiles[1].home
    const service = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      codexProfiles: () => profiles,
      now: () => new Date('2026-09-20T12:01:00Z'),
      processes: () => [
        { pid: 100, provider: 'codex', cwd, codexHome: personalHome },
        { pid: 101, provider: 'codex', cwd, codexHome: workHome },
      ],
      stopProcess: (pid) => stopped.push(pid),
    })
    expect(service.list().sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'same-id',
          name: 'Task Pessoal',
          codexProfileId: 'personal',
          codexProfileName: 'Pessoal',
          pid: 100,
        }),
        expect.objectContaining({
          id: 'same-id',
          name: 'Task Trabalho',
          codexProfileId: 'work',
          codexProfileName: 'Trabalho',
          pid: 101,
        }),
      ]),
    )
    expect(service.list().sessions).toHaveLength(2)
    expect(() => service.stop('same-id')).toThrow('perfis diferentes')
    service.stop('same-id', 'work')
    expect(stopped).toEqual([101])
    profiles = [{ ...profiles[0], name: 'Particular', color: '#ffffff' }, profiles[1]]
    expect(service.list().sessions.find(({ codexProfileId }) => codexProfileId === 'personal')).toMatchObject({
      codexProfileName: 'Particular',
      codexProfileColor: '#ffffff',
    })
    profiles = [profiles[0]]
    expect(service.list().sessions.filter(({ id }) => id === 'same-id')).toHaveLength(1)
  })

  test('does not assign a same-cwd process to a profile when its home cannot be verified', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-unverified-codex-'))
    const cwd = join(root, 'shared-project')
    const profiles: CodexProfile[] = ['personal', 'work'].map((id) => ({
      id,
      name: id,
      home: join(root, `.codex-${id}`),
      color: '#7dd3fc',
    }))
    for (const profile of profiles)
      jsonl(join(profile.home, 'sessions', 'test.jsonl'), [
        { type: 'session_meta', payload: { id: profile.id, cwd } },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ])
    const sessions = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      codexProfiles: () => profiles,
      now: () => new Date('2026-09-20T12:01:00Z'),
      processes: () => [{ pid: 100, provider: 'codex', cwd }],
    }).list().sessions
    expect(sessions.find(({ pid }) => pid === 100)).toMatchObject({ id: 'codex-100', status: 'rodando' })
    expect(sessions.find(({ pid }) => pid === 100)?.codexProfileId).toBeUndefined()
    expect(
      sessions
        .filter(({ codexProfileId }) => Boolean(codexProfileId))
        .every(({ status, pid }) => status === 'concluido' && pid === undefined),
    ).toBe(true)
  })

  test('keeps running and waiting sessions from another profile beyond the global recent-history limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-codex-history-profile-'))
    const profiles: CodexProfile[] = ['personal', 'work'].map((id) => ({
      id,
      name: id,
      home: join(root, `.codex-${id}`),
      color: '#7dd3fc',
    }))
    for (let index = 0; index < 45; index++)
      jsonl(
        join(profiles[0].home, 'sessions', `${index}.jsonl`),
        [
          { type: 'session_meta', payload: { id: `history-${index}`, cwd: root } },
          { type: 'event_msg', payload: { type: 'task_complete' } },
        ],
        new Date('2026-09-20T12:00:30Z'),
      )
    jsonl(join(profiles[1].home, 'sessions', 'active.jsonl'), [
      { type: 'session_meta', payload: { id: 'work-active', cwd: root } },
      { type: 'event_msg', payload: { type: 'task_started' } },
    ])
    jsonl(join(profiles[1].home, 'sessions', 'waiting.jsonl'), [
      { type: 'session_meta', payload: { id: 'work-waiting', cwd: root } },
      { type: 'event_msg', payload: { type: 'request_user_input', questions: [{ question: 'Qual banco?' }] } },
    ])
    const sessions = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      codexProfiles: () => profiles,
      now: () => new Date('2026-09-20T12:01:00Z'),
      processes: () => [],
    }).list().sessions
    expect(sessions).toHaveLength(42)
    expect(sessions.find(({ id }) => id === 'work-active')).toMatchObject({ status: 'rodando', codexProfileId: 'work' })
    expect(sessions.find(({ id }) => id === 'work-waiting')).toMatchObject({
      status: 'aguardando',
      codexProfileId: 'work',
    })
  })

  test('keeps a running launch identifiable when its configured home changes and clears removed labels', () => {
    const root = mkdtempSync(join(tmpdir(), 'mega-brain-codex-edited-home-'))
    const oldHome = join(root, '.codex-personal')
    let profiles: CodexProfile[] = [
      { id: 'personal', name: 'Pessoal', home: join(root, '.codex-new-home'), color: '#7dd3fc' },
      { id: 'work', name: 'Trabalho', home: join(root, '.codex-work'), color: '#a78bfa' },
    ]
    const stopped: number[] = []
    const service = createAgentSessionService({
      home: root,
      claudeProjects: join(root, '.claude', 'projects'),
      codexProfiles: () => profiles,
      processes: () => [{ pid: 100, provider: 'codex', cwd: root, codexHome: oldHome, codexProfileId: 'personal' }],
      stopProcess: (pid) => stopped.push(pid),
    })
    expect(service.list().sessions[0]).toMatchObject({
      id: 'codex-100',
      codexProfileId: 'personal',
      codexProfileName: 'Pessoal',
    })
    service.stop('codex-100', 'personal')
    expect(stopped).toEqual([100])
    profiles = [profiles[1]]
    expect(service.list().sessions[0].codexProfileId).toBeUndefined()
  })
})
