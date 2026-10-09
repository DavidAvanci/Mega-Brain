import { useEffect, useRef, useState } from 'react'
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
import { useCodexModels } from './useCodexModels'
import type { SettingsTab } from './settings-search'

const EMPTY_EDITOR_DISCOVERY: EditorDiscovery = { editors: [], scope: 'máquina do backend' }

export function useSettingsDialog(desktop: boolean, onClose: () => void, activeTab: SettingsTab) {
  const { catalog: codexCatalog, loading: codexModelsLoading, refreshModels } = useCodexModels(activeTab === 'models')
  const [settings, setSettings] = useState<MegaBrainSettings | null>(null)
  const [editorDiscovery, setEditorDiscovery] = useState<EditorDiscovery>(EMPTY_EDITOR_DISCOVERY)
  const [editorsLoaded, setEditorsLoaded] = useState(false)
  const [autostartEnabled, setAutostartEnabled] = useState(false)
  const [autostartLoaded, setAutostartLoaded] = useState(!desktop)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const loadedTabs = useRef(new Set<SettingsTab>())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const nextSettings = await fetchMegaBrainSettings()
        if (cancelled) return
        setSettings(nextSettings)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [desktop])

  useEffect(() => {
    if (!settings || loadedTabs.current.has(activeTab)) return
    loadedTabs.current.add(activeTab)
    if (activeTab === 'ides') {
      void fetchDetectedEditors()
        .then(setEditorDiscovery)
        .catch(() => setEditorDiscovery(EMPTY_EDITOR_DISCOVERY))
        .finally(() => setEditorsLoaded(true))
    } else if (activeTab === 'general' && desktop) {
      void getDesktopAutostartEnabled()
        .then(setAutostartEnabled)
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setAutostartLoaded(true))
    }
  }, [activeTab, desktop, settings])

  const updateStage = (
    key: keyof BoardSettings,
    field: keyof BoardSettings[keyof BoardSettings],
    value: string | boolean,
  ) => {
    setSettings((current) => (current ? withStageSetting(current, key, field, value, codexCatalog) : current))
  }
  const updateGeneral = (general: GeneralSettingsInput) => {
    setSettings((current) => (current ? withGeneralSettings(current, general, codexCatalog) : current))
  }
  const updatePrompts = (prompts: MegaBrainSettings['prompts']) => {
    setSettings((current) => (current ? { ...current, prompts } : current))
  }
  const close = () => {
    setSettings((current) => {
      if (!current) return current
      const general: GeneralSettingsInput = { ...current.general }
      delete general.jevApiKey
      delete general.jevRemoveSavedKey
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
    editorsLoaded,
    autostartEnabled,
    autostartLoaded,
    error,
    saving,
    codexCatalog,
    codexModelsLoading,
    refreshModels,
    setAutostartEnabled,
    updateStage,
    updateGeneral,
    updatePrompts,
    save,
    close,
  }
}
