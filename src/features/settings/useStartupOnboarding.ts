import { useEffect, useState } from 'react'
import { fetchDetectedEditors, fetchMegaBrainSettings } from '../cards/api/card-detail-api'
import type { EditorDiscovery, MegaBrainSettings } from '../../../shared/domain/settings'

export function useStartupOnboarding() {
  const [onboarding, setOnboarding] = useState<{ settings: MegaBrainSettings; editors: EditorDiscovery } | null>(null)
  useEffect(() => {
    let active = true
    void fetchMegaBrainSettings()
      .then(async (settings) => {
        if (!active) return
        const tourNotCompleted = window.localStorage.getItem('mega-brain-onboarding-tour-v1') !== 'done'
        if (settings.general.onboardingCompleted && !tourNotCompleted) return
        const editors = await fetchDetectedEditors().catch(
          () => ({ editors: [], scope: 'máquina do backend' }) satisfies EditorDiscovery,
        )
        if (active) setOnboarding({ settings, editors })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return { onboarding, completeOnboarding: () => setOnboarding(null) }
}
