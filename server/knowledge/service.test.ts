import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { knowledgeService, KnowledgeError } from './service'
import { knowledgeHttp } from './http'
import { configureKnowledgeConnection, knowledgeAgentEnvironment, knowledgeCapability, knowledgeContext } from './agent'
import { knowledgeMentions } from '../../shared/domain/knowledge'
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mega-knowledge-'))
  roots.push(root)
  const file = join(root, 'knowledge', 'catalog.json')
  return { root, file, service: knowledgeService(file) }
}
test('nested folders, pages, search and restart preserve stable identities', () => {
  const { service, file } = fixture()
  const parent = service.create('folder', { title: 'Projetos' })
  const child = service.create('folder', { title: 'Backend', parentId: parent.id })
  const page = service.create('page', {
    title: 'Decisões',
    parentId: child.id,
    markdown: '# API\n\n- Autenticação local',
  })
  expect(service.search('autenticação')).toMatchObject([{ id: page.id, breadcrumbs: ['Projetos', 'Backend'] }])
  service.renameFolder(parent.id, 'Trabalho')
  expect(knowledgeService(file).get(page.id)).toMatchObject({ title: 'Decisões', parentId: child.id, revision: 1 })
  expect(service.resolve([{ kind: 'folder', id: parent.id }])).toHaveLength(1)
})
test('moves reject cycles, folder trash hides descendants and restoration recovers them', () => {
  const { service } = fixture()
  const folder = service.create('folder', { title: 'Pasta' })
  const child = service.create('folder', { title: 'Filha', parentId: folder.id })
  const page = service.create('page', { title: 'Página', parentId: child.id })
  expect(() => service.move({ kind: 'folder', id: folder.id }, child.id)).toThrow('dela mesma')
  service.trash({ kind: 'folder', id: folder.id })
  expect(service.list().pages).toHaveLength(0)
  expect(service.list(true).pages).toHaveLength(1)
  expect(() => service.get(page.id)).toThrow('não encontrada')
  service.restore({ kind: 'folder', id: folder.id })
  expect(service.get(page.id).id).toBe(page.id)
  service.trash({ kind: 'folder', id: folder.id })
  service.restore({ kind: 'page', id: page.id })
  expect(service.get(page.id).parentId).toBeNull()
})
test('optimistic revisions preserve history and reject stale human and agent writes', () => {
  const { service } = fixture()
  const item = service.create('page', { title: 'Original', markdown: 'Antes' })
  const page = service.get(item.id)
  service.update(
    page.id,
    { title: 'Agente', markdown: 'Depois', baseRevision: 1 },
    { kind: 'agent', name: 'Codex', taskId: 'MB-001' },
  )
  try {
    service.update(page.id, { title: 'Rascunho', markdown: 'Texto local', baseRevision: 1 })
    throw new Error('accepted stale write')
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError)
    expect(error).toMatchObject({ status: 409, current: { revision: 2, markdown: 'Depois' } })
  }
  expect(service.get(page.id).history).toMatchObject([{ revision: 1, markdown: 'Antes' }])
  service.restoreRevision(page.id, 1, 2)
  expect(service.get(page.id)).toMatchObject({
    revision: 3,
    markdown: 'Antes',
    history: [{ revision: 1 }, { revision: 2, actor: { name: 'Codex', taskId: 'MB-001' } }],
  })
})
test('HTTP agent capabilities are verified, attributed and limited to reading and editing', async () => {
  const { service } = fixture()
  const handler = knowledgeHttp(service)
  const actor = { kind: 'agent' as const, name: 'Claude', taskId: 'MB-002', sessionId: 'chat-123' }
  const call = (body: unknown, token?: string) =>
    handler({
      method: 'POST',
      path: '/api/knowledge/agent',
      query: new URLSearchParams(),
      headers: { 'x-mega-knowledge-capability': token },
      body,
    })
  expect((await call({ action: 'list' })).status).toBe(401)
  const token = knowledgeCapability(actor)
  expect((await call({ action: 'trash' }, token)).status).toBe(403)
  const created = await call({ action: 'create', input: { title: 'Nota', markdown: 'Agente' } }, token)
  expect(created).toMatchObject({ status: 201, body: { actor } })
  const page = service.list().pages[0]
  expect(
    (await call({ action: 'update', id: page.id, input: { title: 'Nota', markdown: 'Novo', baseRevision: 1 } }, token))
      .status,
  ).toBe(200)
  expect(
    (await call({ action: 'update', id: page.id, input: { title: 'Nota', markdown: 'Outro', baseRevision: 1 } }, token))
      .status,
  ).toBe(409)
  expect((await call({ action: 'list' }, token + 'tampered')).status).toBe(401)
})
test('typed mentions do not conflict with repositories and attached text is bounded', () => {
  const { root } = fixture()
  const settings = join(root, 'settings.json')
  const service = knowledgeService(join(root, 'knowledge', 'catalog.json'))
  const folder = service.create('folder', { title: 'Contexto' })
  const page = service.create('page', { title: 'Grande', parentId: folder.id, markdown: 'x'.repeat(50_000) })
  configureKnowledgeConnection(settings, { url: 'http://127.0.0.1:5173' })
  const mention = `@api @nota[folder:${folder.id}]`
  expect(knowledgeMentions(mention)).toEqual([{ kind: 'folder', id: folder.id }])
  const prompt = knowledgeContext(mention, [], settings)
  expect(prompt).toContain(page.id)
  expect(prompt).toContain('Texto parcial')
  expect(prompt.length).toBeLessThan(26_000)
  const env = knowledgeAgentEnvironment(settings, { kind: 'agent', name: 'Codex' })
  expect(env.MEGA_BRAIN_KNOWLEDGE_CLI).toContain('agent.mjs')
  expect(env.MEGA_BRAIN_KNOWLEDGE_CAPABILITY).toBeTruthy()
  expect(env.MEGA_BRAIN_SESSION_TOKEN).toBeUndefined()
  service.trash({ kind: 'folder', id: folder.id })
  expect(knowledgeContext(mention, [], settings)).not.toContain('x'.repeat(100))
})
