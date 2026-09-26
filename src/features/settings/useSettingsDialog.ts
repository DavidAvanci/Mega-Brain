import { useEffect, useState } from 'react'
import { refresh } from '@/features/cards/model/card-commands'
import {
  fetchDetectedEditors,
  fetchMegaBrainSettings,
  saveMegaBrainSettings,
} from '@/features/cards/api/card-detail-api'
import { getDesktopAutostartEnabled, setDesktopAutostartEnabled } from '@/desktopAutostart'
import type {
  BoardSettings,
  EditorDiscovery,
  GeneralSettingsInput,
  MegaBrainSettings,
} from '../../../shared/domain/settings'
import { withGeneralSettings, withStageSetting } from '@/settings-state'

const EMPTY_EDITOR_DISCOVERY: EditorDiscovery = { editors: [], scope: 'máquina do backend' }

export function useSettingsDialog(desktop: boolean, onClose: () => void) {
  const [settings, setSettings] = useState<MegaBrainSettings | null>(null)
  const [editorDiscovery, setEditorDiscovery] = useState<EditorDiscovery>(EMPTY_EDITOR_DISCOVERY)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [autostartLoaded, setAutostartLoaded] = useState(!desktop)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [nextSettings, discovery, nextAutostartEnabled] = await Promise.all([
          fetchMegaBrainSettings(),
          fetchDetectedEditors().catch(() => EMPTY_EDITOR_DISCOVERY),
          desktop
            ? getDesktopAutostartEnabled().catch((cause) => {
                if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
                return false
              })
            : Promise.resolve(false),
        ])
        if (cancelled) return
        setSettings(nextSettings)
        setEditorDiscovery(discovery)
        setAutostartEnabled(nextAutostartEnabled)
        setAutostartLoaded(true)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [desktop])

  const updateStage = (key: keyof BoardSettings, field: 'model' | 'effort', value: string) => {
    setSettings((current) => (current ? withStageSetting(current, key, field, value) : current))
  }
  const updateGeneral = (general: GeneralSettingsInput) => {
    setSettings((current) => (current ? withGeneralSettings(current, general) : current))
  }
  const close = () => {
    setSettings((current) => {
      if (!current) return current
      const general: GeneralSettingsInput = { ...current.general }
      delete general.layaApiKey
      delete general.layaRemoveSavedKey
      return { ...current, general }
    })
    onClose()
  }
  const save = async () => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      await Promise.all([
        saveMegaBrainSettings(settings),
        desktop ? setDesktopAutostartEnabled(autostartEnabled) : Promise.resolve(),
      ])
      window.dispatchEvent(new Event('megabrain-settings-changed'))
      await refresh()
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }
  return {
    settings,
    editorDiscovery,
    autostartEnabled,
    autostartLoaded,
    error,
    saving,
    setAutostartEnabled,
    updateStage,
    updateGeneral,
    save,
    close,
  }
}
