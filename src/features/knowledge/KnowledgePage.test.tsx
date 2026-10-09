// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { KnowledgePage } from './KnowledgePage'
const api = vi.hoisted(() => ({ list: vi.fn(), search: vi.fn(), create: vi.fn(), read: vi.fn() }))
vi.mock('./api', () => ({ knowledgeApi: api }))
vi.mock('./KnowledgeEditor', () => ({ KnowledgeEditor: () => <div role="textbox" aria-label="Conteúdo da página" /> }))
vi.mock('@/Markdown', () => ({ Markdown: ({ text }: { text: string }) => <p>{text}</p> }))
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api.list.mockResolvedValue({ version: 1, folders: [], pages: [] })
  api.search.mockResolvedValue([])
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})
test('starts with a genuine empty state and accessible icon actions', async () => {
  await act(async () => root.render(<KnowledgePage />))
  expect(host.textContent).toContain('Suas notas começam aqui.')
  expect(host.querySelector('[aria-label="Criar página"]')).toBeTruthy()
  expect(host.querySelector('[aria-label="Criar pasta"]')).toBeTruthy()
  expect(host.querySelector('[aria-label="Pesquisar páginas e pastas"]')).toBeTruthy()
  expect(host.textContent).toContain('Criar página')
})
test('folder expansion reveals nested pages and opens the editor', async () => {
  const folder = { id: 'folder-1', title: 'Projeto', parentId: null, createdAt: '', updatedAt: '' }
  const page = {
    id: 'page-1',
    title: 'Decisão',
    parentId: folder.id,
    createdAt: '',
    updatedAt: '',
    markdown: 'Contexto real',
    revision: 1,
    actor: { kind: 'user', name: 'Você' },
    history: [],
  }
  api.list.mockResolvedValue({ version: 1, folders: [folder], pages: [page] })
  api.read.mockResolvedValue(page)
  await act(async () => root.render(<KnowledgePage />))
  expect(host.textContent).not.toContain('Decisão')
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Expandir Projeto"]')!.click())
  const pageButton = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Decisão')!
  await act(async () => pageButton.click())
  expect(host.querySelector<HTMLInputElement>('[aria-label="Título da página"]')?.value).toBe('Decisão')
  expect(host.querySelector('[aria-label="Conteúdo da página"]')).toBeTruthy()
  expect(host.querySelector('[aria-label="Histórico de revisões"]')).toBeTruthy()
})
