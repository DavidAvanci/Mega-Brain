import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { cardIdFromWorktreeCwd, createAgentSessionService } from './service'

function jsonl(path: string, events: unknown[], modifiedAt = new Date('2026-09-20T12:00:00.000Z')) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, events.map((event) => JSON.stringify(event)).join('\n'))
  utimesSync(path, modifiedAt, modifiedAt)
}

describe('agent session service', () => {
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
        message: {
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
})
