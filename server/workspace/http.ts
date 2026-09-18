import { legacyJsonHandler, type ApiHandler } from '../contracts'
import type { WorkspaceService } from './service'
export const workspaceHttp = (service: WorkspaceService): ApiHandler => legacyJsonHandler(async (r) => ({ status: 200, headers: { 'Content-Type': 'application/json' }, body: await service.handle(r.path, r.method, r.query, r.body) }))
