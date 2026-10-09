import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LlmProvider, ModelStageSettings } from '../../shared/domain/settings'
import {
  compatibleEffort,
  defaultStageSettings,
  FALLBACK_CODEX_CATALOG,
  isClaudeModelAlias,
  isEffort,
  supportedEfforts,
  type CodexModelCatalog,
} from '../../shared/domain/codex-models'

const SETTINGS_FILE = '.mega-brain-settings.json'
export function readStageSettings(
  root: string,
  provider: LlmProvider = 'claude',
  catalog = FALLBACK_CODEX_CATALOG,
): Record<string, ModelStageSettings> {
  let saved: unknown
  try {
    saved = JSON.parse(readFileSync(join(root, SETTINGS_FILE), 'utf8'))
  } catch {
    saved = {}
  }
  const configured = saved && typeof saved === 'object' ? (saved as { stages?: unknown }).stages : undefined
  const entries = configured && typeof configured === 'object' ? (configured as Record<string, unknown>) : {}
  return Object.fromEntries(
    Object.entries(defaultStageSettings(provider, catalog)).map(([name, defaults]) => {
      const value = entries[name]
      if (!value || typeof value !== 'object') return [name, defaults]
      const { model, effort, fastMode } = value as { model?: unknown; effort?: unknown; fastMode?: unknown }
      const savedModel = typeof model === 'string' && model.trim() ? model.trim() : defaults.model
      const effectiveModel = provider === 'chatgpt' && isClaudeModelAlias(savedModel) ? defaults.model : savedModel
      return [
        name,
        {
          model: effectiveModel,
          effort: isEffort(effort) ? effort : defaults.effort,
          fastMode: fastMode === true,
        },
      ]
    }),
  )
}

export function validateStageSettings(
  stages: unknown,
  provider: LlmProvider = 'claude',
  catalog: CodexModelCatalog = FALLBACK_CODEX_CATALOG,
): void {
  if (!stages || typeof stages !== 'object') throw new Error('Configurações de etapas inválidas')
  for (const name of Object.keys(defaultStageSettings(provider, catalog))) {
    const value = (stages as Record<string, unknown>)[name]
    if (!value || typeof value !== 'object') continue
    const { model, effort, fastMode } = value as { model?: unknown; effort?: unknown; fastMode?: unknown }
    if (typeof model !== 'string' || !model.trim()) throw new Error(`Modelo inválido para ${name}`)
    if (!isEffort(effort) || !supportedEfforts(provider, model.trim(), catalog).includes(effort))
      throw new Error(`Effort inválido para ${name}: não suportado pelo modelo ${model.trim()}`)
    if (fastMode !== undefined && typeof fastMode !== 'boolean') throw new Error(`Fast Mode inválido para ${name}`)
  }
}

export function writeStageSettings(
  root: string,
  stages: unknown,
  provider: LlmProvider = 'claude',
  catalog = FALLBACK_CODEX_CATALOG,
): Record<string, ModelStageSettings> {
  validateStageSettings(stages, provider, catalog)
  const settings = readStageSettings(root, provider, catalog)
  for (const name of Object.keys(settings)) {
    const value = (stages as Record<string, unknown>)[name]
    if (!value || typeof value !== 'object') continue
    const { model, effort, fastMode } = value as ModelStageSettings
    settings[name] = {
      model: model.trim(),
      effort: compatibleEffort(provider, model.trim(), effort, catalog),
      fastMode: fastMode === true,
    }
  }
  writeFileSync(join(root, SETTINGS_FILE), `${JSON.stringify({ stages: settings }, null, 2)}\n`)
  return settings
}
