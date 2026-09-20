import type { BoardSettings, GeneralSettings, MegaBrainSettings } from '../shared/domain/settings'

/** Applies a general-settings edit and resets stage defaults only on provider changes. */
export function withGeneralSettings(current: MegaBrainSettings, general: GeneralSettings): MegaBrainSettings {
  if (current.general.llmProvider === general.llmProvider) return { ...current, general }
  const stages = Object.fromEntries(
    Object.entries(current.stages).map(([key, stage]) => [
      key,
      {
        ...stage,
        model: general.llmProvider === 'chatgpt' ? 'default' : key === 'run-test-checklist' ? 'sonnet' : 'fable',
      },
    ]),
  ) as BoardSettings
  return { general, stages }
}

export function withStageSetting(
  current: MegaBrainSettings,
  key: keyof BoardSettings,
  field: 'model' | 'effort',
  value: string,
): MegaBrainSettings {
  return { ...current, stages: { ...current.stages, [key]: { ...current.stages[key], [field]: value } } }
}
