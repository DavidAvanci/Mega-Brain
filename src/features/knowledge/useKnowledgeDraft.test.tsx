// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError } from '@/shared/api/api-client'
import type { KnowledgePage } from '../../../shared/domain/knowledge'
import { draftKey, persistDraft, readDraft, useKnowledgeDraft } from './useKnowledgeDraft'
const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock('./api', () => ({ knowledgeApi: api }))
const initial: KnowledgePage = {
  id: 'page-1',
  title: 'Nota',
  markdown: 'Antes',
  parentId: null,
  revision: 1,
  actor: { kind: 'user', name: 'Você' },
  history: [],
  createdAt: '2026-09-30',
  updatedAt: '2026-09-30',
}
let host: HTMLDivElement
let root: Root
let result: ReturnType<typeof useKnowledgeDraft>
function Harness() {
  result = useKnowledgeDraft('page-1', () => {})
  return <p>{result.status}</p>
}
beforeEach(async () => {
  vi.useFakeTimers()
  localStorage.clear()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  api.read.mockResolvedValue(initial)
  api.save.mockImplementation(async (_id, title, markdown, revision) => ({
    ...initial,
    title,
    markdown,
    revision: revision + 1,
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.clearAllMocks()
})
const mount = async () => {
  await act(async () => root.render(<Harness />))
}
const advance = async (milliseconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}
test('autosaves with the read revision and clears a successfully saved draft', async () => {
  await mount()
  act(() => result.update({ markdown: 'Depois' }))
  expect(readDraft('page-1')).toMatchObject({ markdown: 'Depois', baseRevision: 1 })
  await advance(700)
  expect(api.save).toHaveBeenCalledWith('page-1', 'Nota', 'Depois', 1)
  expect(localStorage.getItem(draftKey('page-1'))).toBeNull()
  expect(result.status).toBe('Salvo')
})
test('failed saves preserve drafts and manual retry saves them', async () => {
  await mount()
  api.save.mockRejectedValueOnce(new Error('Sem conexão'))
  act(() => result.update({ markdown: 'Rascunho' }))
  await advance(700)
  expect(readDraft('page-1')?.markdown).toBe('Rascunho')
  expect(result.error).toBe('Sem conexão')
  await act(async () => {
    await result.retry()
  })
  expect(result.status).toBe('Salvo')
  expect(readDraft('page-1')).toBeNull()
})
test('recovers drafts after remount without replacing them with server content', async () => {
  persistDraft('page-1', { title: 'Local', markdown: 'Texto recuperado', baseRevision: 1 })
  await mount()
  expect(result.draft?.markdown).toBe('Texto recuperado')
  expect(result.status).toBe('Rascunho recuperado')
})
test('stale drafts require explicit reconciliation against the current revision', async () => {
  const remote = { ...initial, revision: 2, markdown: 'Agente', actor: { kind: 'agent' as const, name: 'Codex' } }
  api.read.mockResolvedValue(remote)
  persistDraft('page-1', { title: 'Nota', markdown: 'Meu rascunho', baseRevision: 1 })
  await mount()
  await advance(1000)
  expect(result.conflict?.markdown).toBe('Agente')
  expect(result.draft?.markdown).toBe('Meu rascunho')
  expect(api.save).not.toHaveBeenCalled()
  act(() => result.update({ markdown: 'Versão conciliada' }))
  await act(async () => {
    await result.saveMerged()
  })
  expect(api.save).toHaveBeenCalledWith('page-1', 'Nota', 'Versão conciliada', 2)
  expect(result.conflict).toBeNull()
})
test('HTTP conflict preserves the draft and exposes the agent version', async () => {
  await mount()
  const remote = { ...initial, revision: 2, markdown: 'Versão do agente' }
  api.save.mockRejectedValueOnce(new ApiError('Conflito', 409, { current: remote }))
  act(() => result.update({ markdown: 'Meu rascunho' }))
  await advance(700)
  expect(result.conflict).toEqual(remote)
  expect(result.draft?.markdown).toBe('Meu rascunho')
  expect(readDraft('page-1')?.markdown).toBe('Meu rascunho')
  act(() => result.useRemote())
  expect(result.draft?.markdown).toBe('Versão do agente')
  expect(readDraft('page-1')).toBeNull()
})
test('remote agent updates appear when the page has no unsaved changes', async () => {
  await mount()
  api.read.mockResolvedValue({ ...initial, revision: 2, markdown: 'Agente atualizou' })
  await advance(5000)
  expect(result.draft?.markdown).toBe('Agente atualizou')
  expect(result.conflict).toBeNull()
})
test('typing during an in-flight save keeps the latest draft and rebases the next save', async () => {
  await mount()
  let finish: ((page: KnowledgePage) => void) | undefined
  api.save.mockImplementationOnce(
    () =>
      new Promise<KnowledgePage>((resolve) => {
        finish = resolve
      }),
  )
  act(() => result.update({ markdown: 'Primeiro' }))
  await advance(700)
  act(() => result.update({ markdown: 'Segundo' }))
  await act(async () => {
    finish!({ ...initial, markdown: 'Primeiro', revision: 2 })
  })
  expect(result.draft?.markdown).toBe('Segundo')
  expect(readDraft('page-1')).toMatchObject({ markdown: 'Segundo', baseRevision: 2 })
  await advance(700)
  expect(api.save).toHaveBeenLastCalledWith('page-1', 'Nota', 'Segundo', 2)
})
