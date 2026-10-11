import { useEffect, useState } from 'react'
import { fetchCardDetailSection } from '../api/card-detail-api'
import type { CardAgentUsage, CardAgentUsageEntry } from '../../../../shared/domain/agents'
import { TASK_CHECKLIST_FILE, type TaskChecklist } from '../../../../shared/domain/task-checklist'

export interface CardDetailState {
  files: Record<string, string | null>
  checklist: TaskChecklist | null
  checklistLoaded: boolean
  usage: CardAgentUsage | null
  usageBreakdown: CardAgentUsageEntry[]
  artifactError: string | null
  error: string | null
}

/** Loads and refreshes only the currently requested card detail section. */
export function useCardDetail(cardId: string, section: string, usageEnabled = false, refreshMs = 5_000): CardDetailState {
  const [files, setFiles] = useState<Record<string, string | null>>({})
  const [checklist, setChecklist] = useState<TaskChecklist | null>(null)
  const [checklistLoaded, setChecklistLoaded] = useState(false)
  const [usage, setUsage] = useState<CardAgentUsage | null>(null)
  const [usageBreakdown, setUsageBreakdown] = useState<CardAgentUsageEntry[]>([])
  const [artifactError, setArtifactError] = useState<string | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)

  useEffect(() => {
    setFiles({})
    setChecklist(null)
    setChecklistLoaded(false)
    setArtifactError(null)
    setUsageError(null)
    setUsage(null)
    setUsageBreakdown([])
  }, [cardId])

  useEffect(() => {
    const fileSection = ['PLAN.md', TASK_CHECKLIST_FILE].includes(section)
    if (!fileSection) return
    let cancelled = false
    const load = () => {
      if (section === TASK_CHECKLIST_FILE) {
        return fetchCardDetailSection<{ checklist: TaskChecklist | null }>(cardId, 'checklist')
          .then((data) => {
            if (cancelled) return
            setChecklist(data.checklist)
            setChecklistLoaded(true)
            setArtifactError(null)
          })
          .catch((cause: unknown) => {
            if (!cancelled) setArtifactError(cause instanceof Error ? cause.message : String(cause))
          })
      }
      fetchCardDetailSection<{ file: string; content: string | null }>(cardId, 'file', section)
        .then((data) => {
          if (cancelled) return
          setFiles((current) => ({ ...current, [data.file]: data.content }))
          setArtifactError(null)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setArtifactError(cause instanceof Error ? cause.message : String(cause))
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
    const load = () =>
      fetchCardDetailSection<{ usage: CardAgentUsage; usageBreakdown: CardAgentUsageEntry[] }>(cardId, 'usage')
        .then((result) => {
          if (cancelled) return
          setUsage(result.usage)
          setUsageBreakdown(result.usageBreakdown ?? [])
          setUsageError(null)
        })
        .catch((cause: unknown) => {
          if (!cancelled) setUsageError(cause instanceof Error ? cause.message : String(cause))
        })
    load()
    const timer = window.setInterval(load, refreshMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [cardId, usageEnabled, refreshMs])

  return { files, checklist, checklistLoaded, usage, usageBreakdown, artifactError, error: artifactError ?? usageError }
}
