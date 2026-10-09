import { useEffect, useState } from 'react'
import { fetchCardDetailSection, type WorktreeRepoInfo } from '../api/card-detail-api'
import type { CardAgentUsage, CardAgentUsageEntry } from '../../../../shared/domain/agents'

export interface CardDetailState {
  files: Record<string, string | null>
  repos: WorktreeRepoInfo[] | null
  usage: CardAgentUsage | null
  usageBreakdown: CardAgentUsageEntry[]
  error: string | null
}

/** Loads and refreshes only the currently requested card detail section. */
export function useCardDetail(cardId: string, section: string, usageEnabled = false, refreshMs = 5_000): CardDetailState {
  const [files, setFiles] = useState<Record<string, string | null>>({})
  const [repos, setRepos] = useState<WorktreeRepoInfo[] | null>(null)
  const [usage, setUsage] = useState<CardAgentUsage | null>(null)
  const [usageBreakdown, setUsageBreakdown] = useState<CardAgentUsageEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fileSection = ['PLAN.md', 'TASK-CHECKLIST.md', 'TEST-CHECKLIST.md'].includes(section)
    if (!fileSection && section !== 'repos') return
    let cancelled = false
    const load = () => {
      const request = fileSection
          ? fetchCardDetailSection<{ file: string; content: string | null }>(cardId, 'file', section)
          : fetchCardDetailSection<{ repos: WorktreeRepoInfo[] }>(cardId, 'repos')
      request.then((data) => {
        if (cancelled) return
        if (fileSection) {
          const result = data as { file: string; content: string | null }
          setFiles((current) => ({ ...current, [result.file]: result.content }))
        } else {
          setRepos((data as { repos: WorktreeRepoInfo[] }).repos ?? [])
        }
        setError(null)
      }).catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    }
    load()
    const timer = window.setInterval(load, refreshMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [cardId, section, refreshMs])

  useEffect(() => {
    if (!usageEnabled) return
    let cancelled = false
    const load = () => fetchCardDetailSection<{ usage: CardAgentUsage; usageBreakdown: CardAgentUsageEntry[] }>(cardId, 'usage')
      .then((result) => {
        if (cancelled) return
        setUsage(result.usage)
        setUsageBreakdown(result.usageBreakdown ?? [])
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
  }, [cardId, usageEnabled, refreshMs])

  return { files, repos, usage, usageBreakdown, error }
}
