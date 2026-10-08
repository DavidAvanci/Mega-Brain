import type { ApiHandler } from '../contracts'
import { knowledgeRefs } from '../../shared/domain/knowledge'
import { knowledgeCapabilityActor } from './agent'
import { KnowledgeError, type KnowledgeService } from './service'
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
export function knowledgeHttp(service: KnowledgeService): ApiHandler {
  return async (request) => {
    const json = (status: number, body: unknown) => ({ status, body, headers: { 'Content-Type': 'application/json' } })
    try {
      const body = record(request.body)
      const id = request.query.get('id') ?? String(body.id ?? '')
      const path = request.path
      const method = request.method
      if (path === '/api/knowledge/agent') {
        const actor = knowledgeCapabilityActor(request.headers['x-mega-knowledge-capability'])
        if (!actor) return json(401, { error: 'Credencial de agente inválida ou expirada' })
        const input = record(body.input)
        if (body.action === 'list') return json(200, service.search(''))
        if (body.action === 'search') return json(200, service.search(String(body.query ?? '')))
        if (body.action === 'read') {
          const page = service.get(id)
          return json(200, {
            id: page.id,
            title: page.title,
            markdown: page.markdown,
            revision: page.revision,
            parentId: page.parentId,
            actor: page.actor,
            updatedAt: page.updatedAt,
          })
        }
        if (body.action === 'create')
          return json(
            201,
            service.create('page', { title: input.title, markdown: input.markdown, parentId: input.parentId }, actor),
          )
        if (body.action === 'update')
          return json(
            200,
            service.update(
              id,
              { title: input.title, markdown: input.markdown, baseRevision: input.baseRevision },
              actor,
            ),
          )
        return json(403, { error: 'Esta ação não está disponível para agentes' })
      }
      if (method === 'GET' && path === '/api/knowledge')
        return json(200, service.list(request.query.get('trash') === 'true'))
      if (method === 'GET' && path === '/api/knowledge/search')
        return json(200, service.search(request.query.get('q') ?? ''))
      if (method === 'GET' && path === '/api/knowledge/page') return json(200, service.get(id))
      if (method === 'GET' && path === '/api/knowledge/revisions') return json(200, service.get(id, true).history)
      if (method === 'POST' && path === '/api/knowledge') {
        if (body.kind !== 'folder' && body.kind !== 'page') throw new KnowledgeError('Tipo inválido')
        return json(
          201,
          service.create(body.kind, { title: body.title, parentId: body.parentId, markdown: body.markdown }),
        )
      }
      if (method === 'PUT' && path === '/api/knowledge/page')
        return json(
          200,
          service.update(id, { title: body.title, markdown: body.markdown, baseRevision: body.baseRevision }),
        )
      if (method === 'PUT' && path === '/api/knowledge/folder') return json(200, service.renameFolder(id, body.title))
      const ref = knowledgeRefs([body.ref])[0]
      if (
        method === 'POST' &&
        ['/api/knowledge/move', '/api/knowledge/trash', '/api/knowledge/restore'].includes(path)
      ) {
        if (!ref) throw new KnowledgeError('Referência inválida')
        if (path.endsWith('/move')) return json(200, service.move(ref, body.parentId))
        if (path.endsWith('/trash')) return json(200, service.trash(ref))
        return json(200, service.restore(ref))
      }
      if (method === 'POST' && path === '/api/knowledge/revisions')
        return json(200, service.restoreRevision(id, Number(body.revision), Number(body.baseRevision)))
      return json(404, { error: 'Rota não encontrada' })
    } catch (error) {
      return json(error instanceof KnowledgeError ? error.status : 500, {
        error: error instanceof Error ? error.message : 'Falha ao acessar o conhecimento',
        ...(error instanceof KnowledgeError && error.current ? { current: error.current } : {}),
      })
    }
  }
}
