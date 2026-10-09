import { useEffect, useState } from 'react'
import type { IslandDisplaySettings, IslandIntent } from '../shared/domain/activity-island'
import { isMacOSDesktop } from './desktopBootstrap'
import { requestJson } from './shared/api/request-json'

/** The native companion requests navigation through the authenticated backend. */
export function useActivityIsland(
  onOpenCard: (id: string) => void,
  onOpenSettings: () => void,
  onOpenAgents: () => void,
): boolean {
  const [taskSounds, setTaskSounds] = useState(true)
  useEffect(() => {
    if (!isMacOSDesktop()) return
    let active = true
    let polling = false
    const poll = async () => {
      if (polling) return
      polling = true
      try {
        const [intent, display] = await Promise.all([
          requestJson<IslandIntent | null>('/api/activity-intent', 'Falha ao ler destino da ilha'),
          requestJson<IslandDisplaySettings>('/api/activity-island/settings', 'Falha ao ler ilha'),
        ])
        if (!active) return
        setTaskSounds(display.taskSounds)
        if (intent?.target === 'settings') onOpenSettings()
        else if (intent?.target === 'agents') onOpenAgents()
        else if (intent?.target === 'task' && intent.taskId) onOpenCard(intent.taskId)
      } catch {
        /* The desktop connection boundary handles backend failures. */
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1250)
    window.addEventListener('focus', poll)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', poll)
    }
  }, [onOpenCard, onOpenSettings, onOpenAgents])
  return taskSounds
}
