import { useEffect, useState } from 'react'

const STORAGE_KEY = 'mega-brain-board-preferences-v1'

export type BoardView = 'board' | 'list'
export type BoardFlowFilter = 'all' | 'simples' | 'medio' | 'dificil'
export type BoardStateFilter = 'all' | 'running' | 'waiting' | 'error' | 'pr'

export interface BoardPreferences {
  view: BoardView
  attentionOnly: boolean
  flow: BoardFlowFilter
  state: BoardStateFilter
}

const DEFAULT_PREFERENCES: BoardPreferences = {
  view: 'board',
  attentionOnly: false,
  flow: 'all',
  state: 'all',
}

function readPreferences(): BoardPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<BoardPreferences> | null
    if (!saved) return DEFAULT_PREFERENCES
    return {
      view: saved.view === 'list' ? 'list' : 'board',
      attentionOnly: saved.attentionOnly ?? DEFAULT_PREFERENCES.attentionOnly,
      flow: ['all', 'simples', 'medio', 'dificil'].includes(saved.flow ?? '')
        ? (saved.flow as BoardFlowFilter)
        : DEFAULT_PREFERENCES.flow,
      state: ['all', 'running', 'waiting', 'error', 'pr'].includes(saved.state ?? '')
        ? (saved.state as BoardStateFilter)
        : DEFAULT_PREFERENCES.state,
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

export function useBoardPreferences() {
  const [preferences, setPreferences] = useState<BoardPreferences>(readPreferences)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  }, [preferences])

  const updatePreferences = (patch: Partial<BoardPreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }))
  }

  return [preferences, updatePreferences] as const
}
