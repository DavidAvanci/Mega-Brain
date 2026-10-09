export type KnowledgeRef = { kind: 'page' | 'folder'; id: string }
export type KnowledgeActor = { kind: 'user' | 'agent'; name: string; taskId?: string; sessionId?: string }
export type KnowledgeFolder = {
  id: string
  title: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  trashedAt?: string
}
export type KnowledgeRevision = {
  revision: number
  title: string
  markdown: string
  updatedAt: string
  actor: KnowledgeActor
}
export type KnowledgePage = KnowledgeFolder & {
  markdown: string
  revision: number
  actor: KnowledgeActor
  history: KnowledgeRevision[]
}
export type KnowledgeCatalog = { version: 1; folders: KnowledgeFolder[]; pages: KnowledgePage[] }
export type KnowledgeSearchResult = KnowledgeRef & { title: string; breadcrumbs: string[]; snippet: string }
export function knowledgeRefs(value: unknown): KnowledgeRef[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || !('kind' in item) || !('id' in item)) return []
    if (
      (item.kind !== 'page' && item.kind !== 'folder') ||
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(item.id)
    )
      return []
    return [{ kind: item.kind, id: item.id }]
  })
}
export function knowledgeMentions(text: string): KnowledgeRef[] {
  return [...text.matchAll(/@nota\[(page|folder):([a-zA-Z0-9-]{1,80})\]/g)].map((match) => ({
    kind: match[1] === 'page' ? 'page' : 'folder',
    id: match[2],
  }))
}
