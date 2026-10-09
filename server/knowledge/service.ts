import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { repositoryCatalogFile } from '../repositories/catalog'
import type {
  KnowledgeActor,
  KnowledgeCatalog,
  KnowledgePage,
  KnowledgeRef,
  KnowledgeRevision,
  KnowledgeSearchResult,
} from '../../shared/domain/knowledge'

export const USER_ACTOR: KnowledgeActor = { kind: 'user', name: 'Você' }
export class KnowledgeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly current?: KnowledgePage,
  ) {
    super(message)
  }
}
export function knowledgeFile(settingsFile?: string): string {
  return join(dirname(repositoryCatalogFile(settingsFile)), 'knowledge', 'catalog.json')
}
function text(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new KnowledgeError(`${label} inválido`)
  return value
}
export function knowledgeService(file = knowledgeFile()) {
  const load = (): KnowledgeCatalog => {
    if (!existsSync(file)) return { version: 1, folders: [], pages: [] }
    const catalog: KnowledgeCatalog = JSON.parse(readFileSync(file, 'utf8'))
    if (catalog.version !== 1 || !Array.isArray(catalog.folders) || !Array.isArray(catalog.pages))
      throw new KnowledgeError('Base de conhecimento inválida', 500)
    return catalog
  }
  const persist = (catalog: KnowledgeCatalog) => {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomUUID()}.tmp`
    writeFileSync(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, file)
  }
  const find = (catalog: KnowledgeCatalog, ref: KnowledgeRef) => {
    const item = (ref.kind === 'page' ? catalog.pages : catalog.folders).find((item) => item.id === ref.id)
    if (!item) throw new KnowledgeError('Página ou pasta não encontrada', 404)
    return item
  }
  const isTrashed = (catalog: KnowledgeCatalog, item: { parentId: string | null; trashedAt?: string }): boolean => {
    if (item.trashedAt) return true
    const seen = new Set<string>()
    let parent = item.parentId
    while (parent) {
      if (seen.has(parent)) throw new KnowledgeError('Hierarquia inválida', 500)
      seen.add(parent)
      const folder = catalog.folders.find((folder) => folder.id === parent)
      if (!folder || folder.trashedAt) return true
      parent = folder.parentId
    }
    return false
  }
  const parent = (catalog: KnowledgeCatalog, value: unknown): string | null => {
    if (value === null || value === undefined) return null
    if (typeof value !== 'string') throw new KnowledgeError('Pasta inválida')
    const folder = find(catalog, { kind: 'folder', id: value })
    if (isTrashed(catalog, folder)) throw new KnowledgeError('A pasta está na lixeira')
    return value
  }
  const snapshot = (page: KnowledgePage): KnowledgeRevision => ({
    revision: page.revision,
    title: page.title,
    markdown: page.markdown,
    updatedAt: page.updatedAt,
    actor: page.actor,
  })
  const get = (id: string, includeTrash = false): KnowledgePage => {
    const catalog = load()
    const page = catalog.pages.find((page) => page.id === id)
    if (!page || (!includeTrash && isTrashed(catalog, page))) throw new KnowledgeError('Página não encontrada', 404)
    return page
  }
  const list = (trash = false): KnowledgeCatalog => {
    const catalog = load()
    const sort = <T extends { title: string }>(items: T[]) =>
      items.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
    return {
      version: 1,
      folders: sort(catalog.folders.filter((item) => isTrashed(catalog, item) === trash)),
      pages: sort(catalog.pages.filter((item) => isTrashed(catalog, item) === trash)),
    }
  }
  const update = (
    id: string,
    input: { title: unknown; markdown: unknown; baseRevision: unknown },
    actor = USER_ACTOR,
  ): KnowledgePage => {
    const catalog = load()
    const page = catalog.pages.find((page) => page.id === id)
    if (!page || isTrashed(catalog, page)) throw new KnowledgeError('Página não encontrada', 404)
    if (input.baseRevision !== page.revision)
      throw new KnowledgeError('Esta página foi alterada. Compare as versões antes de salvar.', 409, page)
    const title = text(input.title, 'Título', 240).trim() || 'Sem título'
    const markdown = text(input.markdown, 'Texto', 1_000_000)
    page.history.push(snapshot(page))
    Object.assign(page, { title, markdown, revision: page.revision + 1, updatedAt: new Date().toISOString(), actor })
    persist(catalog)
    return page
  }
  return {
    list,
    get,
    update,
    create(
      kind: KnowledgeRef['kind'],
      input: { title: unknown; parentId?: unknown; markdown?: unknown },
      actor = USER_ACTOR,
    ) {
      const catalog = load()
      const now = new Date().toISOString()
      const item = {
        id: randomUUID(),
        title: text(input.title, 'Título', 240).trim() || 'Sem título',
        parentId: parent(catalog, input.parentId),
        createdAt: now,
        updatedAt: now,
      }
      if (kind === 'folder') {
        catalog.folders.push(item)
        persist(catalog)
        return item
      }
      const page: KnowledgePage = {
        ...item,
        markdown: text(input.markdown ?? '', 'Texto', 1_000_000),
        revision: 1,
        actor,
        history: [],
      }
      catalog.pages.push(page)
      persist(catalog)
      return page
    },
    move(ref: KnowledgeRef, parentId: unknown) {
      const catalog = load()
      const item = find(catalog, ref)
      if (isTrashed(catalog, item)) throw new KnowledgeError('O item está na lixeira')
      const destination = parent(catalog, parentId)
      let ancestor = destination
      while (ancestor) {
        if (ref.kind === 'folder' && ancestor === ref.id)
          throw new KnowledgeError('Não é possível mover uma pasta para dentro dela mesma')
        ancestor = catalog.folders.find((folder) => folder.id === ancestor)?.parentId ?? null
      }
      item.parentId = destination
      item.updatedAt = new Date().toISOString()
      persist(catalog)
      return item
    },
    renameFolder(id: string, title: unknown) {
      const catalog = load()
      const folder = find(catalog, { kind: 'folder', id })
      folder.title = text(title, 'Título', 240).trim() || 'Sem título'
      folder.updatedAt = new Date().toISOString()
      persist(catalog)
      return folder
    },
    trash(ref: KnowledgeRef) {
      const catalog = load()
      const item = find(catalog, ref)
      item.trashedAt = new Date().toISOString()
      persist(catalog)
      return { ok: true }
    },
    restore(ref: KnowledgeRef) {
      const catalog = load()
      const item = find(catalog, ref)
      delete item.trashedAt
      if (
        item.parentId &&
        isTrashed(
          catalog,
          catalog.folders.find((folder) => folder.id === item.parentId) ?? { parentId: null, trashedAt: 'missing' },
        )
      )
        item.parentId = null
      persist(catalog)
      return item
    },
    restoreRevision(id: string, revision: number, baseRevision: number) {
      const page = get(id)
      const previous = page.history.find((item) => item.revision === revision)
      if (!previous) throw new KnowledgeError('Revisão não encontrada', 404)
      return update(id, { title: previous.title, markdown: previous.markdown, baseRevision })
    },
    search(query: string): KnowledgeSearchResult[] {
      const catalog = list()
      const needle = query.toLocaleLowerCase('pt-BR').trim()
      return [
        ...catalog.folders.map((folder) => ({ ...folder, kind: 'folder' as const, markdown: '' })),
        ...catalog.pages.map((page) => ({ ...page, kind: 'page' as const })),
      ]
        .filter((item) => `${item.title} ${item.markdown}`.toLocaleLowerCase('pt-BR').includes(needle))
        .map((item) => {
          const breadcrumbs: string[] = []
          let parent = item.parentId
          while (parent) {
            const folder = catalog.folders.find((folder) => folder.id === parent)
            if (!folder) break
            breadcrumbs.unshift(folder.title)
            parent = folder.parentId
          }
          const position = Math.max(0, item.markdown.toLocaleLowerCase('pt-BR').indexOf(needle))
          return {
            kind: item.kind,
            id: item.id,
            title: item.title,
            breadcrumbs,
            snippet: item.markdown.slice(Math.max(0, position - 40), position + 160),
          }
        })
        .slice(0, 100)
    },
    resolve(refs: KnowledgeRef[]): KnowledgePage[] {
      const catalog = list()
      const ids = new Set(refs.filter((ref) => ref.kind === 'page').map((ref) => ref.id))
      const folders = new Set(refs.filter((ref) => ref.kind === 'folder').map((ref) => ref.id))
      for (let changed = true; changed;) {
        changed = false
        for (const folder of catalog.folders)
          if (folder.parentId && folders.has(folder.parentId) && !folders.has(folder.id)) {
            folders.add(folder.id)
            changed = true
          }
      }
      return catalog.pages.filter((page) => ids.has(page.id) || (page.parentId !== null && folders.has(page.parentId)))
    },
  }
}
export type KnowledgeService = ReturnType<typeof knowledgeService>
