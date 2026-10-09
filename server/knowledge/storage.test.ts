import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { loadMegaBrainConfig } from '../config'
import { readGeneralSettings } from '../app-settings'
import { createProductionRouteTable } from '../production-routes'
import { createViteRouteHandler } from '../../viteMegaBrainPlugin'
import { knowledgeAgentEnvironment, knowledgeContext } from './agent'
import { knowledgeFile, knowledgeService, migrateKnowledgeStorage, workspaceKnowledgeFile } from './service'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mega-knowledge-storage-'))
  roots.push(root)
  const config = loadMegaBrainConfig({
    homeDir: root,
    env: {
      WORKSPACE_DIR: join(root, 'data', 'cards'),
      MEGA_BRAIN_SETTINGS_FILE: join(root, 'app-config', 'settings.json'),
    },
  })
  return { root, config }
}

test('copies the legacy catalog beside cards with all references and revisions intact, retaining the original', () => {
  const { root, config } = fixture()
  const source = knowledgeFile(config.preferences.settingsFile)
  const legacy = knowledgeService(source)
  const folder = legacy.create('folder', { title: 'Rules' })
  const page = legacy.create('page', { title: 'Original', markdown: 'First version', parentId: folder.id })
  legacy.update(page.id, { title: 'Updated', markdown: 'Latest version', baseRevision: 1 })
  const trashed = legacy.create('page', { title: 'Archived' })
  legacy.trash({ kind: 'page', id: trashed.id })
  const original = readFileSync(source, 'utf8')

  const destination = migrateKnowledgeStorage(config.preferences.settingsFile, config.workspaceDir)
  expect(destination).toBe(join(root, 'data', 'knowledge', 'catalog.json'))
  expect(readGeneralSettings(config).knowledgeDir).toBe(dirname(destination))
  expect(readFileSync(destination, 'utf8')).toBe(original)
  expect(readFileSync(source, 'utf8')).toBe(original)
  expect(statSync(destination).mode & 0o777).toBe(0o600)
  expect(readdirSync(dirname(destination))).toEqual(['catalog.json'])
  const migrated = knowledgeService(destination)
  expect(migrated.get(page.id)).toMatchObject({ parentId: folder.id, revision: 2, history: [{ revision: 1 }] })
  expect(migrated.list(true).pages.map((page) => page.id)).toContain(trashed.id)

  migrated.update(page.id, { title: 'Updated again', markdown: 'New location', baseRevision: 2 })
  migrateKnowledgeStorage(config.preferences.settingsFile, config.workspaceDir)
  expect(migrated.get(page.id).revision).toBe(3)
  expect(readFileSync(source, 'utf8')).toBe(original)
})

test('an existing destination catalog is preserved instead of being replaced by the legacy catalog', () => {
  const { config } = fixture()
  const oldPage = knowledgeService(knowledgeFile(config.preferences.settingsFile)).create('page', { title: 'Old' })
  const destination = workspaceKnowledgeFile(config.workspaceDir)
  const active = knowledgeService(destination)
  const currentPage = active.create('page', { title: 'Current' })
  const current = readFileSync(destination, 'utf8')
  migrateKnowledgeStorage(config.preferences.settingsFile, config.workspaceDir)
  expect(readFileSync(destination, 'utf8')).toBe(current)
  expect(active.get(currentPage.id).title).toBe('Current')
  expect(() => active.get(oldPage.id)).toThrow('Página não encontrada')
})

test('fresh installations write their first page beside cards without creating a legacy catalog', () => {
  const { config } = fixture()
  const path = () => migrateKnowledgeStorage(config.preferences.settingsFile, config.workspaceDir)
  const service = knowledgeService(path)
  expect(service.list().pages).toEqual([])
  expect(existsSync(path())).toBe(false)
  const page = service.create('page', { title: 'New page' })
  expect(knowledgeService(workspaceKnowledgeFile(config.workspaceDir)).get(page.id).title).toBe('New page')
  expect(existsSync(knowledgeFile(config.preferences.settingsFile))).toBe(false)
})

test('invalid legacy catalogs are retained without publishing a replacement', () => {
  const { config } = fixture()
  const source = knowledgeFile(config.preferences.settingsFile)
  mkdirSync(dirname(source), { recursive: true })
  writeFileSync(source, '{"version":1,"pages":[]}')
  expect(() => migrateKnowledgeStorage(config.preferences.settingsFile, config.workspaceDir)).toThrow(
    'Base de conhecimento inválida',
  )
  expect(existsSync(workspaceKnowledgeFile(config.workspaceDir))).toBe(false)
  expect(readFileSync(source, 'utf8')).toBe('{"version":1,"pages":[]}')
})

test('HTTP requests and agent context follow the cards parent when settings change without a restart', async () => {
  const { root, config } = fixture()
  const source = knowledgeFile(config.preferences.settingsFile)
  const page = knowledgeService(source).create('page', { title: 'Rule', markdown: 'Keep this rule' })
  const handler = createViteRouteHandler(createProductionRouteTable({ config }))
  const request = (method: string, path: string, body?: unknown) =>
    handler({
      method,
      path,
      body,
      query: new URLSearchParams(),
      headers: { host: '127.0.0.1:5173' },
    })
  expect(await request('GET', '/api/workspace/settings')).toMatchObject({
    status: 200,
    body: { general: { knowledgeDir: join(root, 'data', 'knowledge') } },
  })
  expect(existsSync(workspaceKnowledgeFile(config.workspaceDir))).toBe(true)
  expect(await request('GET', '/api/knowledge')).toMatchObject({ status: 200, body: { pages: [{ id: page.id }] } })
  const previous = workspaceKnowledgeFile(config.workspaceDir)
  const active = knowledgeService(previous)
  active.update(page.id, { title: 'Rule', markdown: 'Latest rule', baseRevision: 1 })
  expect(
    await request('POST', '/api/workspace/settings', {
      general: {
        ...readGeneralSettings(config),
        editor: 'custom',
        editorCommand: '/bin/sh',
        workspaceDir: join(root, 'relocated', 'cards'),
        worktreesDir: join(root, 'relocated', 'worktrees'),
      },
    }),
  ).toMatchObject({ status: 200, body: { general: { knowledgeDir: join(root, 'relocated', 'knowledge') } } })
  expect(await request('GET', '/api/knowledge')).toMatchObject({
    status: 200,
    body: { pages: [{ id: page.id, markdown: 'Latest rule', revision: 2 }] },
  })
  expect(knowledgeContext('Task', [{ kind: 'page', id: page.id }], config.preferences.settingsFile)).toContain(
    'Latest rule',
  )
  const environment = knowledgeAgentEnvironment(config.preferences.settingsFile, { kind: 'agent', name: 'Codex' })
  expect(environment.MEGA_BRAIN_KNOWLEDGE_CLI).toBe(join(root, 'relocated', 'knowledge', 'agent.mjs'))
  expect(existsSync(previous)).toBe(true)
  expect(existsSync(source)).toBe(true)

  expect(await request('POST', '/api/knowledge', { kind: 'page', title: 'After relocation' })).toMatchObject({
    status: 201,
  })
  expect(knowledgeService(workspaceKnowledgeFile(config.workspaceDir)).list().pages).toHaveLength(2)
  expect(active.list().pages).toHaveLength(1)
})
