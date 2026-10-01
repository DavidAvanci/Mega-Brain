import { useEffect, useState } from 'react'
import { fetchDetail, type WorktreeRepoInfo } from '../api/card-detail-api'
import type { CardAgentUsage, CardAgentUsageEntry } from '../../../../shared/domain/agents'

export interface CardDetailState {
  files: Record<string, string | null> | null
  repos: WorktreeRepoInfo[] | null
  usage: CardAgentUsage | null
  usageBreakdown: CardAgentUsageEntry[]
  error: string | null
}

/** Polls the card-specific artefacts while the detail dialog is open. */
export function useCardDetail(cardId: string, refreshMs = 5_000): CardDetailState {
  const [files, setFiles] = useState<Record<string, string | null> | null>(null)
  const [repos, setRepos] = useState<WorktreeRepoInfo[] | null>(null)
  const [usage, setUsage] = useState<CardAgentUsage | null>(null)
  const [usageBreakdown, setUsageBreakdown] = useState<CardAgentUsageEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetchDetail(cardId)
        .then((data) => {
          if (cancelled) return
          setFiles(data.files)
          setRepos(data.repos ?? [])
          setUsage(data.usage)
          setUsageBreakdown(data.usageBreakdown ?? [])
          setError(null)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
        })
    load()
    const timer = window.setInterval(load, refreshMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [cardId, refreshMs])

  return { files, repos, usage, usageBreakdown, error }
}
