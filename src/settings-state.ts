import {
  DEFAULT_PROMPTS,
  type BoardSettings,
  type GeneralSettingsInput,
  type MegaBrainSettings,
} from '../shared/domain/settings'
import {
  compatibleEffort,
  defaultStageSettings,
  FALLBACK_CODEX_CATALOG,
  isEffort,
  type CodexModelCatalog,
} from '../shared/domain/codex-models'
import { JEV_PLANNING_MODEL } from '../shared/domain/planning-selection'

export function withSettingsDefaults(
  settings: MegaBrainSettings,
  catalog: CodexModelCatalog = FALLBACK_CODEX_CATALOG,
): MegaBrainSettings {
  const defaults = defaultStageSettings(settings.general.llmProvider, catalog)
  const stages = Object.fromEntries(
    (Object.keys(defaults) as (keyof BoardSettings)[]).map((key) => {
      const saved =
        settings.stages?.[key] ?? (key === 'task-verification' ? settings.stages?.['run-task-checklist'] : undefined)
      return [key, { ...defaults[key], ...saved }]
    }),
  ) as BoardSettings
  return { ...settings, stages, prompts: { ...DEFAULT_PROMPTS, ...settings.prompts } }
}

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
  const normalized = withSettingsDefaults(current, catalog)
  const previous = normalized.stages[key]
  const effortModel = (model: string) =>
    model === JEV_PLANNING_MODEL
      ? defaultStageSettings(current.general.llmProvider, catalog)['task-planning'].model
      : model
  const next = String(value)
  const stage =
    field === 'fastMode'
      ? { ...previous, fastMode: value === true }
      : field === 'model'
        ? {
            ...previous,
            model: String(value),
            effort: compatibleEffort(current.general.llmProvider, effortModel(String(value)), previous.effort, catalog),
          }
        : {
            ...previous,
            effort: isEffort(next)
              ? compatibleEffort(current.general.llmProvider, effortModel(previous.model), next, catalog)
              : previous.effort,
          }
  return { ...normalized, stages: { ...normalized.stages, [key]: stage } }
}
