import type { BoardSettings, GeneralSettingsInput, MegaBrainSettings } from '../shared/domain/settings'
import {
  compatibleEffort,
  defaultStageSettings,
  FALLBACK_CODEX_CATALOG,
  isEffort,
  type CodexModelCatalog,
} from '../shared/domain/codex-models'

/** Applies a general-settings edit and resets stage defaults only on provider changes. */
export function withGeneralSettings(
  current: MegaBrainSettings,
  general: GeneralSettingsInput,
  catalog: CodexModelCatalog = FALLBACK_CODEX_CATALOG,
): MegaBrainSettings {
  if (current.general.llmProvider === general.llmProvider) return { ...current, general }
  const stages = defaultStageSettings(general.llmProvider, catalog)
  return { general, stages, prompts: current.prompts }
}

export function withStageSetting(
  current: MegaBrainSettings,
  key: keyof BoardSettings,
  field: keyof BoardSettings[keyof BoardSettings],
  value: string | boolean,
  catalog: CodexModelCatalog = FALLBACK_CODEX_CATALOG,
): MegaBrainSettings {
  const previous = current.stages[key]
  const stage =
    field === 'fastMode'
      ? { ...previous, fastMode: value === true }
      : field === 'model'
      ? {
          ...previous,
          model: String(value),
          effort: compatibleEffort(current.general.llmProvider, String(value), previous.effort, catalog),
        }
      : {
          ...previous,
          effort: isEffort(String(value))
            ? compatibleEffort(current.general.llmProvider, previous.model, String(value), catalog)
            : previous.effort,
        }
  return { ...current, stages: { ...current.stages, [key]: stage } }
}
