import { useCallback, useEffect, useState } from 'react'
import { requestJson } from '@/shared/api/request-json'
import { FALLBACK_CODEX_CATALOG, type CodexModelCatalog } from '../../../shared/domain/codex-models'

export function useCodexModels() {
  const [catalog, setCatalog] = useState(FALLBACK_CODEX_CATALOG)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const refreshModels = useCallback(() => setRefreshKey((key) => key + 1), [])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void requestJson<CodexModelCatalog>(
      `/api/codex/models${refreshKey ? '?refresh=true' : ''}`,
      'Falha ao consultar os modelos do Codex',
    )
      .then((value) => {
        if (!cancelled) setCatalog(value)
      })
      .catch(() => {
        if (!cancelled) setCatalog(FALLBACK_CODEX_CATALOG)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])
  useEffect(() => {
    window.addEventListener('megabrain:codex-profiles-changed', refreshModels)
    return () => window.removeEventListener('megabrain:codex-profiles-changed', refreshModels)
  }, [refreshModels])
  return { catalog, loading, refreshModels }
}
