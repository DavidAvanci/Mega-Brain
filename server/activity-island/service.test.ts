import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { loadMegaBrainConfig } from '../config'
import { activityIslandHttp, projectActivity, validateDisplay } from './service'
import { createServerRuntime } from '../runtime'
import { createStandaloneServer, type StandaloneServer } from '../main'
import type { ApiRequest } from '../contracts'
import type { AgentSession } from '../../shared/domain/agents'
import { createChatService } from '../chat/service'
import { taskConversation } from '../chat/task-conversation'
import type { IslandActivity } from '../../shared/domain/activity-island'
import { createProductionRouteTable } from '../production-routes'
import type { CodexProfiles } from '../../shared/domain/codex-profiles'

const directories: string[] = []
const servers: StandaloneServer[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mega-island-'))
  directories.push(root)
  const config = loadMegaBrainConfig({
    homeDir: root,
    env: {
      WORKSPACE_DIR: join(root, 'cards'),
      MEGA_BRAIN_SETTINGS_FILE: join(root, 'settings.json'),
    },
  })
  return { root, config }
}
const request = (method: string, path: string, body?: unknown): ApiRequest => ({
  method,
  path,
  body,
  query: new URLSearchParams(),
  headers: {},
})

test('projects simultaneous agents uniquely and excludes finished executions', () => {
  const activities = projectActivity({
    name: 'card-1',
    title: 'Card',
    agents: [
      { status: 'rodando', provider: 'codex', sessionId: 'a', progress: { done: 2, total: 5 } },
      { status: 'aguardando', provider: 'claude', sessionId: 'b' },
      { status: 'concluido' },
      { status: 'morto' },
      { status: 'erro' },
    ],
  })
  expect(activities.map((activity) => activity.status)).toEqual(['running', 'waiting'])
  expect(new Set(activities.map((activity) => activity.taskId)).size).toBe(2)
  expect(activities[0]).toMatchObject({ cardId: 'card-1', agent: 'codex', checked: 2, total: 5 })
})

test('saves partial preferences across restarts and rejects unsafe dimensions', async () => {
  const { config, root } = fixture()
  const handler = activityIslandHttp(config, () => [])
  const saved = await handler(
    request('PUT', '/api/activity-island/settings', { enabled: false, maxWidth: 800, taskSounds: false }),
  )
  expect(saved.status).toBe(200)
  expect(JSON.parse(readFileSync(join(root, 'activity-island.json'), 'utf8'))).toMatchObject({
    maxWidth: 800,
    enabled: false,
  })
  const restarted = activityIslandHttp(config, () => [])
  expect((await restarted(request('GET', '/api/activity-island/settings'))).body).toMatchObject({
    maxWidth: 800,
    taskSounds: false,
  })
  expect((await restarted(request('PUT', '/api/activity-island/settings', { maxHeight: 10000 }))).status).toBe(400)
  expect((await restarted(request('GET', '/api/activity-island/settings'))).body).toMatchObject({ maxHeight: 270 })
  expect(() => validateDisplay({ enabled: 'yes' })).toThrow()
  expect(() => validateDisplay({ fontSize: 9.5 })).toThrow()
})

test('migrates earlier preferences with new defaults and persists safe personalization immediately', async () => {
  const { config, root } = fixture()
  writeFileSync(join(root, 'activity-island.json'), JSON.stringify({ maxWidth: 800, style: 'clean' }))
  const handler = activityIslandHttp(config, () => [])
  expect((await handler(request('GET', '/api/activity-island/settings'))).body).toMatchObject({
    maxWidth: 800,
    style: 'clean',
    animations: true,
    runningColor: '#64B8FF',
    petAppearance: 'auto',
  })
  const patch = {
    petAppearance: 'claude',
    petSize: 32,
    animations: false,
    animationSpeed: 150,
    runningColor: '#123abc',
    thinkingColor: '#abcdef',
    waitingColor: '#456789',
    successColor: '#228844',
    errorColor: '#cc4455',
    autoExpandOnWaiting: false,
    compactOthers: false,
    showActivity: false,
    cornerRadius: 20,
    compactWidth: 400,
  }
  expect((await handler(request('PUT', '/api/activity-island/settings', patch))).status).toBe(200)
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({ display: patch })
  const restarted = activityIslandHttp(config, () => [])
  expect((await restarted(request('GET', '/api/activity-island/settings'))).body).toMatchObject(patch)
  for (const invalid of [
    { petAppearance: 'dog' },
    { petSize: 100 },
    { animations: 'yes' },
    { animationSpeed: 0 },
    { runningColor: 'red' },
    { runningColor: '#fff' },
    { compactWidth: 900 },
    { cornerRadius: 0 },
  ])
    expect((await restarted(request('PUT', '/api/activity-island/settings', invalid))).status).toBe(400)
})

test('reads card-linked sessions, prioritizes input and leaves card/stage state untouched', async () => {
  const { config } = fixture()
  const folder = join(config.workspaceDir, 'card-1')
  mkdirSync(folder, { recursive: true })
  const card = JSON.stringify({ title: 'Real card', description: '', status: 'planejando' })
  writeFileSync(join(folder, 'card.json'), card)
  const sessions: AgentSession[] = [
    {
      id: 'codex',
      provider: 'codex',
      status: 'rodando',
      cwd: folder,
      title: 'A',
      cardId: 'card-1',
      startedAt: '',
      updatedAt: '',
    },
    {
      id: 'claude',
      provider: 'claude',
      status: 'aguardando',
      cwd: folder,
      title: 'B',
      cardId: 'card-1',
      startedAt: '',
      updatedAt: '',
    },
  ]
  const handler = activityIslandHttp(config, () => sessions)
  const result = await handler(request('GET', '/api/activity-island'))
  expect(result.body).toMatchObject({
    live: [
      { cardId: 'card-1', title: 'Real card', status: 'waiting', agent: 'claude' },
      { cardId: 'card-1', title: 'Real card', status: 'running', agent: 'codex' },
    ],
  })
  expect(readFileSync(join(folder, 'card.json'), 'utf8')).toBe(card)
})

test('does not revive a finished stage when another session is active in the card folder', async () => {
  const { config } = fixture()
  const folder = join(config.workspaceDir, 'card-1')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'card.json'), JSON.stringify({ title: 'Card', status: 'code-review' }))
  writeFileSync(join(folder, 'agent.json'), JSON.stringify({ stage: 'task-planning', pid: process.pid }))
  writeFileSync(join(folder, 'task-planning.jsonl'), JSON.stringify({ type: 'result', subtype: 'success' }) + '\n')
  const handler = activityIslandHttp(config, () => [
    {
      id: 'new-session',
      provider: 'codex',
      status: 'rodando',
      cwd: folder,
      title: 'New',
      cardId: 'card-1',
      startedAt: '',
      updatedAt: '',
    },
  ])
  const result = await handler(request('GET', '/api/activity-island'))
  expect(result.body).toMatchObject({ live: [{ taskId: 'card-1:new-session', agent: 'codex' }] })
  expect((result.body as { live: unknown[] }).live).toHaveLength(1)
})

test('enriches the owned stage from its exact session without granting an unrelated linked CLI reply access', async () => {
  const { config } = fixture()
  const folder = join(config.workspaceDir, 'card-1')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'card.json'), JSON.stringify({ title: 'Card', status: 'planejando' }))
  writeFileSync(join(folder, 'agent.json'), JSON.stringify({ stage: 'task-planning', pid: process.pid }))
  writeFileSync(
    join(folder, 'task-planning.jsonl'),
    JSON.stringify({ type: 'thread.started', thread_id: 'owned' }) + '\n',
  )
  const session = (id: string): AgentSession => ({
    id,
    provider: 'codex',
    status: 'rodando',
    cwd: folder,
    title: id,
    cardId: 'card-1',
    startedAt: '',
    updatedAt: '',
  })
  const handler = activityIslandHttp(config, () => [
    {
      ...session('owned'),
      status: 'aguardando',
      activity: 'request_user_input',
      question: 'Qual banco devemos usar?',
      visualState: 'waiting',
    },
    session('outside'),
  ])
  const body = (await handler(request('GET', '/api/activity-island'))).body as { live: IslandActivity[] }
  expect(body.live).toHaveLength(2)
  expect(body.live[0]).toMatchObject({
    taskId: 'card-1:owned',
    agent: 'codex',
    replyMode: 'card',
    question: 'Qual banco devemos usar?',
    visualState: 'waiting',
    activity: 'request_user_input',
  })
  expect(body.live[1]).toMatchObject({ taskId: 'card-1:outside', replyMode: 'external' })
  expect(
    (await handler(request('POST', '/api/activity-island/reply', { taskId: 'card-1:outside', message: 'Postgres' })))
      .status,
  ).toBe(409)
})

test('replies to workflow cards through the existing durable chat queue and rejects changed executions', async () => {
  const { config } = fixture()
  const folder = join(config.workspaceDir, 'card-1')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'card.json'), JSON.stringify({ title: 'Card', status: 'planejando' }))
  writeFileSync(join(folder, 'agent.json'), JSON.stringify({ stage: 'task-planning', pid: process.pid }))
  writeFileSync(
    join(folder, 'task-planning.jsonl'),
    JSON.stringify({ type: 'thread.started', thread_id: 'owned' }) + '\n',
  )
  const chat = createChatService(config, {
    spawn() {
      throw new Error('A queued reply must not start another agent')
    },
    execFile() {
      throw new Error('unexpected exec')
    },
    execFileSync() {
      throw new Error('unexpected exec')
    },
  })
  const handler = activityIslandHttp(config, () => [], { chat })
  const reply = await handler(
    request('POST', '/api/activity-island/reply', { taskId: 'card-1:owned', message: 'Use Postgres, por favor.' }),
  )
  expect(reply).toMatchObject({ status: 200, body: { delivery: 'queued' } })
  expect(taskConversation(folder)).toContainEqual(
    expect.objectContaining({ role: 'user', text: 'Use Postgres, por favor.', queued: true }),
  )
  writeFileSync(
    join(folder, 'task-planning.jsonl'),
    JSON.stringify({ type: 'thread.started', thread_id: 'replacement' }) + '\n',
  )
  expect(
    (
      await handler(
        request('POST', '/api/activity-island/reply', { taskId: 'card-1:owned', message: 'Outra resposta' }),
      )
    ).status,
  ).toBe(409)
  expect(taskConversation(folder)).toHaveLength(1)
  for (const input of [
    { taskId: 'card-1:replacement', message: '' },
    { taskId: 'card-1:replacement', message: 'a'.repeat(12001) },
    { taskId: '../../card-1', message: 'Resposta' },
  ])
    expect((await handler(request('POST', '/api/activity-island/reply', input))).status).toBeGreaterThanOrEqual(400)
})

test('shows only observed completion/error transitions and expires them without replaying old history', async () => {
  const { config } = fixture()
  let now = 1000
  const session: AgentSession = {
    id: 'a',
    provider: 'codex',
    status: 'rodando',
    cwd: '/projects/editor',
    title: 'Agent',
    startedAt: '',
    updatedAt: '',
  }
  let sessions: AgentSession[] = [{ ...session, id: 'historical', status: 'concluido' }, session]
  const handler = activityIslandHttp(config, () => sessions, { now: () => now })
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({ recent: [] })
  sessions = [{ ...session, status: 'concluido' }]
  const completed = (await handler(request('GET', '/api/activity-island'))).body as { recent: IslandActivity[] }
  expect(completed.recent).toMatchObject([{ taskId: 'codex:a', status: 'complete', visualState: 'complete' }])
  now += 15001
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({ recent: [] })
  sessions = [session]
  await handler(request('GET', '/api/activity-island'))
  sessions = [{ ...session, status: 'erro' }]
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({
    recent: [{ status: 'error', visualState: 'error' }],
  })
})

test('registers the reply route in the shared production surface', () => {
  const { config } = fixture()
  expect(createProductionRouteTable({ config }).has('POST /api/activity-island/reply')).toBe(true)
  expect(createProductionRouteTable({ config }).has('PATCH /api/activity-island/settings')).toBe(true)
  expect(createProductionRouteTable({ config }).has('GET /api/codex/profiles')).toBe(true)
  expect(createProductionRouteTable({ config }).has('PUT /api/codex/profiles')).toBe(true)
})

test('keeps matching session IDs in different profiles distinct and updates their labels live', async () => {
  const { config } = fixture()
  let profiles: CodexProfiles = {
    profiles: [
      { id: 'work', name: 'Trabalho', home: '/profiles/work', color: '#123abc' },
      { id: 'personal', name: 'Pessoal', home: '/profiles/personal', color: '#abcdef' },
    ],
    activeId: 'work',
  }
  const session: AgentSession = {
    id: 'same-thread',
    provider: 'codex',
    status: 'rodando',
    cwd: '/projects/editor',
    title: 'Editor',
    startedAt: '',
    updatedAt: '',
  }
  const handler = activityIslandHttp(
    config,
    () => [
      { ...session, codexProfileId: 'work', codexProfileName: 'Old name' },
      { ...session, codexProfileId: 'personal' },
    ],
    { codexProfiles: () => profiles },
  )
  const snapshot = (await handler(request('GET', '/api/activity-island'))).body as { live: IslandActivity[] }
  expect(snapshot.live.map((activity) => activity.taskId)).toEqual([
    'codex:work:same-thread',
    'codex:personal:same-thread',
  ])
  expect(snapshot.live).toMatchObject([
    { codexProfileName: 'Trabalho', codexProfileColor: '#123abc' },
    { codexProfileName: 'Pessoal', codexProfileColor: '#abcdef' },
  ])
  profiles = {
    ...profiles,
    profiles: profiles.profiles.map((profile) =>
      profile.id === 'work' ? { ...profile, name: 'Takeat', color: '#ffb454' } : profile,
    ),
  }
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({
    activeCodexProfileId: 'work',
    live: [{ codexProfileName: 'Takeat', codexProfileColor: '#ffb454' }, {}],
  })
})

test('hiding a profile does not fabricate completion and persists independently of the launch default', async () => {
  const { config } = fixture()
  const profiles: CodexProfiles = {
    profiles: [{ id: 'work', name: 'Trabalho', home: '/profiles/work', color: '#123abc' }],
    activeId: 'work',
  }
  const session: AgentSession = {
    id: 'thread',
    provider: 'codex',
    codexProfileId: 'work',
    status: 'rodando',
    cwd: '/projects/editor',
    title: 'Editor',
    startedAt: '',
    updatedAt: '',
  }
  let sessions = [session]
  const handler = activityIslandHttp(config, () => sessions, { codexProfiles: () => profiles })
  await handler(request('GET', '/api/activity-island'))
  expect(
    (
      await handler(
        request('PUT', '/api/activity-island/settings', {
          hiddenCodexProfileIds: ['work', 'work'],
          showProfileBadge: false,
        }),
      )
    ).status,
  ).toBe(200)
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({
    live: [],
    recent: [],
    activeCodexProfileId: 'work',
  })
  const restarted = activityIslandHttp(config, () => sessions, { codexProfiles: () => profiles })
  expect((await restarted(request('GET', '/api/activity-island'))).body).toMatchObject({
    live: [],
    recent: [],
    display: { hiddenCodexProfileIds: ['work'], showProfileBadge: false },
    activeCodexProfileId: 'work',
  })
  await handler(request('PUT', '/api/activity-island/settings', { hiddenCodexProfileIds: [] }))
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({
    live: [{ taskId: 'codex:work:thread' }],
    recent: [],
  })
  sessions = [{ ...session, status: 'concluido' }]
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({
    live: [],
    recent: [{ status: 'complete' }],
  })
  for (const invalid of [
    { hiddenCodexProfileIds: ['../work'] },
    { hiddenCodexProfileIds: 'work' },
    { hiddenCodexProfileIds: [null] },
    { showProfileBadge: 'yes' },
  ])
    expect((await handler(request('PUT', '/api/activity-island/settings', invalid))).status).toBe(400)
})

test('a same-ID session from another profile cannot become the card reply target', async () => {
  const { config } = fixture()
  const folder = join(config.workspaceDir, 'card-1')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'card.json'), JSON.stringify({ title: 'Card', status: 'planejando' }))
  writeFileSync(
    join(folder, 'agent.json'),
    JSON.stringify({
      stage: 'task-planning',
      pid: process.pid,
      provider: 'codex',
      codexProfileId: 'work',
      codexProfileName: 'Trabalho',
    }),
  )
  writeFileSync(
    join(folder, 'task-planning.jsonl'),
    JSON.stringify({ type: 'thread.started', thread_id: 'owned' }) + '\n',
  )
  const handler = activityIslandHttp(config, () => [
    {
      id: 'owned',
      provider: 'codex',
      codexProfileId: 'personal',
      status: 'aguardando',
      cwd: folder,
      cardId: 'card-1',
      title: 'Another profile',
      startedAt: '',
      updatedAt: '',
      question: 'Pergunta externa?',
    },
  ])
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({
    live: [
      { taskId: 'card-1:personal:owned', replyMode: 'external', question: 'Pergunta externa?' },
      { taskId: 'card-1:work:owned', replyMode: 'card' },
    ],
  })
  expect(
    (
      await handler(
        request('POST', '/api/activity-island/reply', { taskId: 'card-1:personal:owned', message: 'Resposta' }),
      )
    ).status,
  ).toBe(409)
})

test('production profile operations require authentication and update the native snapshot without restarting', async () => {
  const { config, root } = fixture()
  const token = 'production-profiles-token'.repeat(3)
  const server = createStandaloneServer({ config, runtime: createServerRuntime({ config }), sessionToken: token })
  servers.push(server)
  await server.start()
  const base = `http://127.0.0.1:${server.address().port}`
  const profiles: CodexProfiles = {
    profiles: [
      { id: 'work', name: 'Trabalho', home: join(root, '.codex-work'), color: '#123abc' },
      { id: 'personal', name: 'Pessoal', home: join(root, '.codex-personal'), color: '#abcdef' },
    ],
    activeId: 'personal',
  }
  expect((await fetch(`${base}/api/codex/profiles`)).status).toBe(401)
  expect(
    (
      await fetch(`${base}/api/codex/profiles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profiles),
      })
    ).status,
  ).toBe(401)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  expect(
    (await fetch(`${base}/api/codex/profiles`, { method: 'PUT', headers, body: JSON.stringify(profiles) })).status,
  ).toBe(200)
  expect(await (await fetch(`${base}/api/codex/profiles`, { headers })).json()).toMatchObject(profiles)
  expect(await (await fetch(`${base}/api/activity-island`, { headers })).json()).toMatchObject({
    codexProfiles: profiles.profiles,
    activeCodexProfileId: 'personal',
  })
})

test('uses card chat for a question from an exact owned session after the stage turn ends', async () => {
  const { config } = fixture()
  const folder = join(config.workspaceDir, 'card-1')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'card.json'), JSON.stringify({ title: 'Card', status: 'planejando' }))
  writeFileSync(join(folder, 'agent.json'), JSON.stringify({ stage: 'task-planning', pid: process.pid }))
  writeFileSync(
    join(folder, 'task-planning.jsonl'),
    [{ type: 'thread.started', thread_id: 'owned' }, { type: 'turn.completed' }]
      .map((event) => JSON.stringify(event))
      .join('\n'),
  )
  const sent: { name: string; message: string }[] = []
  const handler = activityIslandHttp(
    config,
    () => [
      {
        id: 'owned',
        provider: 'codex',
        status: 'aguardando',
        cwd: folder,
        cardId: 'card-1',
        title: 'Card',
        startedAt: '',
        updatedAt: '',
        question: 'Qual banco usar?',
      },
    ],
    {
      chat: {
        send(name, message, emit) {
          sent.push({ name, message })
          emit({ type: 'done' })
        },
      },
    },
  )
  expect((await handler(request('GET', '/api/activity-island'))).body).toMatchObject({
    live: [{ taskId: 'card-1:owned', status: 'waiting', replyMode: 'card', question: 'Qual banco usar?' }],
  })
  expect(
    (await handler(request('POST', '/api/activity-island/reply', { taskId: 'card-1:owned', message: 'Postgres' })))
      .body,
  ).toMatchObject({ delivery: 'sent' })
  expect(sent).toEqual([{ name: 'card-1', message: 'Postgres' }])
})

test.each(
  ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'].flatMap((origin) =>
    ['PATCH', 'PUT'].map((method) => ({ origin, method })),
  ),
)(
  'desktop settings $method from $origin passes preflight and saves only with authentication',
  async ({ origin, method }) => {
    const { config, root } = fixture()
    const token = 'production-island-token'.repeat(3)
    const server = createStandaloneServer({ config, runtime: createServerRuntime({ config }), sessionToken: token })
    servers.push(server)
    await server.start()
    const base = `http://127.0.0.1:${server.address().port}`
    const patch = { enabled: false, petSize: 30, animations: false, waitingColor: '#ffcc88' }
    const preflight = await fetch(`${base}/api/activity-island/settings`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin)
    expect(preflight.headers.get('access-control-allow-methods')?.split(', ')).toContain(method)
    expect(
      (
        await fetch(`${base}/api/activity-island/settings`, {
          method,
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await fetch(`${base}/api/activity-island/settings`, {
          method,
          headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
      ).status,
    ).toBe(200)
    const snapshot = await fetch(`${base}/api/activity-island`, {
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
    })
    expect(snapshot.headers.get('access-control-allow-origin')).toBe(origin)
    expect(await snapshot.json()).toMatchObject({ display: patch })
    expect(JSON.parse(readFileSync(join(root, 'activity-island.json'), 'utf8'))).toMatchObject(patch)
  },
)

test('includes standalone Codex agents from the Agents page even without a workspace', async () => {
  const { config } = fixture()
  const id = '019c7714-3b77-74d1-9866-e1f484aae2ab'
  const handler = activityIslandHttp(config, () => [
    {
      id,
      provider: 'codex',
      status: 'rodando',
      cwd: '/projects/editor',
      title: 'Raw prompt',
      name: 'Implement toolbar',
      startedAt: '',
      updatedAt: '',
      activity: 'Editing window chrome',
    },
    {
      id: 'finished',
      provider: 'codex',
      status: 'concluido',
      cwd: '/projects/editor',
      title: 'Finished',
      startedAt: '',
      updatedAt: '',
    },
  ])
  const result = await handler(request('GET', '/api/activity-island'))
  expect(result.body).toMatchObject({
    live: [{ taskId: `codex:${id}`, threadId: id, title: 'Implement toolbar', project: 'editor', status: 'running' }],
  })
  expect((result.body as { live: unknown[] }).live).toHaveLength(1)
})

test('includes external waiting sessions and routes their fallback to Agents', async () => {
  const { config } = fixture()
  const handler = activityIslandHttp(config, () => [
    {
      id: 'cli-process',
      provider: 'codex',
      status: 'rodando',
      cwd: '/projects/editor',
      title: 'CLI',
      startedAt: '',
      updatedAt: '',
    },
    {
      id: 'claude-waiting',
      provider: 'claude',
      status: 'aguardando',
      cwd: '/projects/api',
      title: 'Needs input',
      startedAt: '',
      updatedAt: '',
    },
  ])
  const response = await handler(request('GET', '/api/activity-island'))
  const live = (response.body as { live: { taskId: string; cardId?: string; threadId?: string; status: string }[] })
    .live
  expect(live.map((activity) => activity.status)).toEqual(['waiting', 'running'])
  expect(live.every((activity) => !activity.cardId && !activity.threadId)).toBe(true)
  expect((await handler(request('POST', '/api/activity-intent', { target: 'agents' }))).status).toBe(200)
  expect((await handler(request('GET', '/api/activity-intent'))).body).toMatchObject({ target: 'agents' })
})

test('navigation intents are consumed once and reject invalid destinations', async () => {
  const { config } = fixture()
  const handler = activityIslandHttp(config, () => [])
  expect((await handler(request('POST', '/api/activity-intent', { target: 'task' }))).status).toBe(400)
  await handler(request('POST', '/api/activity-intent', { target: 'task', taskId: 'card-1' }))
  expect((await handler(request('GET', '/api/activity-intent'))).body).toMatchObject({
    target: 'task',
    taskId: 'card-1',
  })
  expect((await handler(request('GET', '/api/activity-intent'))).body).toBeNull()
})

test('island snapshot and mutations require the desktop Bearer capability', async () => {
  const { config } = fixture()
  const token = 'island-test-token'.repeat(4)
  const runtime = createServerRuntime()
  const handler = activityIslandHttp(config, () => [])
  runtime.register('GET', '/api/activity-island', handler)
  runtime.register('PUT', '/api/activity-island/settings', handler)
  runtime.register('POST', '/api/activity-island/reply', handler)
  const server = createStandaloneServer({ config, runtime, sessionToken: token })
  servers.push(server)
  await server.start()
  const base = `http://127.0.0.1:${server.address().port}`
  expect((await fetch(`${base}/api/activity-island`)).status).toBe(401)
  expect(
    (
      await fetch(`${base}/api/activity-island/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await fetch(`${base}/api/activity-island/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'codex:outside', message: 'Reply' }),
      })
    ).status,
  ).toBe(401)
  expect(
    (
      await fetch(`${base}/api/activity-island/reply`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'codex:outside', message: 'Reply' }),
      })
    ).status,
  ).toBe(409)
  const response = await fetch(`${base}/api/activity-island`, { headers: { Authorization: `Bearer ${token}` } })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ live: [], display: { enabled: true } })
})
