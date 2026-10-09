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
  field: 'model' | 'effort',
  value: string,
  catalog: CodexModelCatalog = FALLBACK_CODEX_CATALOG,
): MegaBrainSettings {
  const previous = current.stages[key]
  const stage =
    field === 'model'
      ? { model: value, effort: compatibleEffort(current.general.llmProvider, value, previous.effort, catalog) }
      : {
          ...previous,
          effort: isEffort(value)
            ? compatibleEffort(current.general.llmProvider, previous.model, value, catalog)
            : previous.effort,
        }
  return { ...current, stages: { ...current.stages, [key]: stage } }
}
