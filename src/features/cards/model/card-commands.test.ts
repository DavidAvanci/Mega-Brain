import { beforeEach, afterEach, expect, test, vi } from 'vitest'

const api = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), jira: vi.fn(), transition: vi.fn() }))
vi.mock('../api/cards-api', () => ({
  listWorkspace: api.list,
  updateWorkspaceCard: api.update,
  createWorkspaceCard: vi.fn(),
  deleteWorkspaceCard: vi.fn(),
  workspaceAction: vi.fn(),
}))
vi.mock('../integrations/jira', () => ({
  fetchJiraStatuses: api.jira,
  fetchReadyJiraIssues: vi.fn(),
  transitionJiraStatus: api.transition,
}))
vi.mock('../../../desktopConnection', () => ({ reportDesktopApiFailure: vi.fn() }))

const folder = {
  name: 'MB-1',
  path: '/MB-1',
  title: 'Card',
  description: '',
  createdAt: '',
  status: 'a-fazer',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubGlobal('localStorage', { getItem: () => null })
  api.list.mockResolvedValue([folder])
  api.jira.mockResolvedValue({})
  api.transition.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const commands = await import('./card-commands')
  const state = await import('./cards-state')
  await commands.refresh()
  return { ...commands, ...state }
}

test('ignores a workspace response started before a move, even after saving', async () => {
  const { refresh, moveCard, cardsState } = await setup()
  const oldList = deferred<(typeof folder)[]>()
  const update = deferred<unknown>()
  api.list.mockReturnValueOnce(oldList.promise)
  api.update.mockReturnValueOnce(update.promise)
  const oldRefresh = refresh()
  moveCard('MB-1', 'code-review')
  api.list.mockResolvedValue([{ ...folder, status: 'code-review' }])
  update.resolve({})
  await vi.waitFor(() => expect(api.list).toHaveBeenCalledTimes(3))
  oldList.resolve([folder])
  await oldRefresh
  expect(cardsState().cards[0].status).toBe('code-review')
})

test('preserves the destination and agent indicator during polling while saving', async () => {
  const { refresh, moveCard, cardsState } = await setup()
  api.update.mockReturnValueOnce(deferred<unknown>().promise)
  moveCard('MB-1', 'planejando')
  await refresh()
  expect(cardsState().cards[0]).toMatchObject({
    status: 'planejando',
    agents: [{ status: 'rodando', phase: 'Iniciando agente' }],
  })
})

test('does not revert a move when an older Jira lookup finishes', async () => {
  const { refresh, moveCard, cardsState } = await setup()
  const jira = deferred<Record<string, string>>()
  api.jira.mockReturnValueOnce(jira.promise)
  const oldRefresh = refresh()
  await vi.waitFor(() => expect(api.jira).toHaveBeenCalledTimes(2))
  api.update.mockReturnValueOnce(deferred<unknown>().promise)
  moveCard('MB-1', 'code-review')
  jira.resolve({})
  await oldRefresh
  expect(cardsState().cards[0].status).toBe('code-review')
})

test('ignores a refresh that completes after a newer refresh', async () => {
  const { refresh, cardsState } = await setup()
  const oldList = deferred<(typeof folder)[]>()
  api.list.mockReturnValueOnce(oldList.promise)
  const oldRefresh = refresh()
  api.list.mockResolvedValue([{ ...folder, status: 'code-review' }])
  await refresh()
  oldList.resolve([folder])
  await oldRefresh
  expect(cardsState().cards[0].status).toBe('code-review')
})

test('reconciles a failed save with the backend and displays the error', async () => {
  const { moveCard, cardsState } = await setup()
  const update = deferred<unknown>()
  api.update.mockReturnValueOnce(update.promise)
  moveCard('MB-1', 'code-review')
  update.reject(new Error('Falha ao mover o card'))
  await vi.waitFor(() => expect(cardsState().error).toBe('Falha ao mover o card'))
  expect(cardsState().cards[0].status).toBe('a-fazer')
})

test('accepts subsequent automatic backend transitions after saving', async () => {
  const { refresh, moveCard, cardsState } = await setup()
  const update = deferred<unknown>()
  api.update.mockReturnValueOnce(update.promise)
  moveCard('MB-1', 'planejando')
  api.list.mockResolvedValue([{ ...folder, status: 'desenvolvendo' }])
  update.resolve({})
  await vi.waitFor(() => expect(cardsState().cards[0].status).toBe('desenvolvendo'))
  await refresh()
  expect(cardsState().cards[0].status).toBe('desenvolvendo')
})
