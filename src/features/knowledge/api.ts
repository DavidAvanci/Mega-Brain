import { requestJson } from '@/shared/api/request-json'
import type {
  KnowledgeCatalog,
  KnowledgePage,
  KnowledgeRef,
  KnowledgeRevision,
  KnowledgeSearchResult,
} from '../../../shared/domain/knowledge'
const call = <T>(path: string, method = 'GET', body?: unknown) =>
  requestJson<T>(`/api/knowledge${path}`, 'Falha ao acessar o conhecimento', { method, body })
export const knowledgeApi = {
  list: (trash = false) => call<KnowledgeCatalog>(`?trash=${trash}`),
  read: (id: string) => call<KnowledgePage>(`/page?id=${encodeURIComponent(id)}`),
  search: (query: string) => call<KnowledgeSearchResult[]>(`/search?q=${encodeURIComponent(query)}`),
  create: (kind: KnowledgeRef['kind'], title: string, parentId: string | null = null, markdown = '') =>
    call<KnowledgePage>('', 'POST', { kind, title, parentId, markdown }),
  save: (id: string, title: string, markdown: string, baseRevision: number) =>
    call<KnowledgePage>('/page', 'PUT', { id, title, markdown, baseRevision }),
  renameFolder: (id: string, title: string) => call('/folder', 'PUT', { id, title }),
  move: (ref: KnowledgeRef, parentId: string | null) => call('/move', 'POST', { ref, parentId }),
  trash: (ref: KnowledgeRef) => call('/trash', 'POST', { ref }),
  restore: (ref: KnowledgeRef) => call('/restore', 'POST', { ref }),
  history: (id: string) => call<KnowledgeRevision[]>(`/revisions?id=${encodeURIComponent(id)}`),
  restoreRevision: (id: string, revision: number, baseRevision: number) =>
    call<KnowledgePage>('/revisions', 'POST', { id, revision, baseRevision }),
}
