import { createInterface } from 'node:readline'
import { codexBin } from '../agent-executable'
import { nodeProcessRunner, type ProcessOwner, type ProcessRunner } from '../process'
import {
  EFFORT_ORDER,
  FALLBACK_CODEX_CATALOG,
  isEffort,
  type CodexModel,
  type CodexModelCatalog,
} from '../../shared/domain/codex-models'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export function parseCodexModels(value: unknown): CodexModel[] {
  const data = record(value).data
  if (!Array.isArray(data)) return []
  const models = new Map<string, CodexModel>()
  for (const raw of data) {
    const entry = record(raw)
    if (entry.hidden === true || typeof entry.model !== 'string' || !entry.model.trim()) continue
    const supported = Array.isArray(entry.supportedReasoningEfforts)
      ? entry.supportedReasoningEfforts.map((value) => record(value).reasoningEffort).filter(isEffort)
      : []
    const supportedEfforts = EFFORT_ORDER.filter((effort) => supported.includes(effort))
    if (!supportedEfforts.length) continue
    const id = entry.model.trim()
    const reference = FALLBACK_CODEX_CATALOG.models.find((model) => model.id === id)
    models.set(id, {
      id,
      label: reference?.label ?? (typeof entry.displayName === 'string' ? entry.displayName : id),
      description: reference?.description ?? (typeof entry.description === 'string' ? entry.description : ''),
      supportedEfforts,
      defaultEffort:
        isEffort(entry.defaultReasoningEffort) && supportedEfforts.includes(entry.defaultReasoningEffort)
          ? entry.defaultReasoningEffort
          : supportedEfforts[0],
      isDefault: entry.isDefault === true,
    })
  }
  return [...models.values()]
}

/** Discovery starts no turns and retains only model metadata, never auth responses. */
export function createCodexModelsService(
  executable?: string,
  home?: string,
  runner: ProcessRunner = nodeProcessRunner,
  owner?: ProcessOwner,
  timeoutMs = 10_000,
) {
  let cached: CodexModelCatalog | undefined
  let expires = 0
  let pending: Promise<CodexModelCatalog> | undefined
  const read = async (): Promise<CodexModelCatalog> => {
    let catalog: CodexModelCatalog = { ...(cached ?? FALLBACK_CODEX_CATALOG), source: 'fallback' }
    try {
      const child = runner.spawn(codexBin(executable), ['app-server'], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...(home ? { CODEX_HOME: home } : {}) },
      })
      owner?.own(child, { label: 'codex-models' })
      const lines = createInterface({ input: child.stdout! })
      try {
        catalog = await new Promise<CodexModelCatalog>((resolve) => {
          let settled = false
          let requestId = 1
          const models = new Map<string, CodexModel>()
          const cursors = new Set<string>()
          const finish = (value = catalog) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
          }
          const timer = setTimeout(() => finish(), timeoutMs)
          const send = (packet: unknown) => {
            if (!child.stdin?.destroyed) child.stdin?.write(JSON.stringify(packet) + '\n')
          }
          child.on('error', () => finish())
          child.on('exit', () => finish())
          child.stdin?.on('error', () => finish())
          lines.on('line', (line) => {
            if (settled) return
            try {
              const packet = record(JSON.parse(line))
              if (packet.id === 'config') {
                const model = record(record(packet.result).config).model
                finish({ ...catalog, ...(typeof model === 'string' && model ? { defaultModelId: model } : {}) })
              } else if (packet.id === 0) {
                if (packet.error) return finish()
                send({ method: 'initialized' })
                send({ id: requestId, method: 'model/list', params: { limit: 100, includeHidden: false } })
              } else if (packet.id === requestId) {
                if (packet.error) return finish()
                for (const model of parseCodexModels(packet.result)) models.set(model.id, model)
                const cursor = record(packet.result).nextCursor
                if (typeof cursor === 'string' && cursor && !cursors.has(cursor) && cursors.size < 10) {
                  cursors.add(cursor)
                  send({ id: ++requestId, method: 'model/list', params: { limit: 100, includeHidden: false, cursor } })
                } else {
                  if (!models.size) return finish()
                  catalog = { models: [...models.values()], source: 'codex' }
                  send({ id: 'config', method: 'config/read', params: { includeLayers: false } })
                }
              }
            } catch {
              // Ignore malformed notifications. No provider diagnostics are retained.
            }
          })
          send({
            id: 0,
            method: 'initialize',
            params: { clientInfo: { name: 'mega_brain_models', title: 'Mega Brain', version: '0.1.0' } },
          })
        })
      } finally {
        lines.close()
        child.stdin?.end()
        child.kill('SIGTERM')
      }
    } catch {
      // Offline or missing CLI: expose the reference catalog with explicit provenance.
    }
    cached = catalog
    expires = Date.now() + (catalog.source === 'codex' ? 300_000 : 30_000)
    return catalog
  }
  return {
    async getModels(refresh = false): Promise<CodexModelCatalog> {
      if (!refresh && cached && Date.now() < expires) return cached
      pending ??= read().finally(() => {
        pending = undefined
      })
      return pending
    },
  }
}
