import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelStageSettings } from '../../shared/domain/settings'

const SETTINGS_FILE = '.mega-brain-settings.json'
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

const MODEL_STAGE_DEFAULTS: Record<string, ModelStageSettings> = {
  'task-planning': { model: 'fable', effort: 'high' },
  'run-task-checklist': { model: 'fable', effort: 'low' },
  'run-test-checklist': { model: 'sonnet', effort: 'low' },
}

export function readStageSettings(root: string): Record<string, ModelStageSettings> {
  let saved: unknown
  try {
    saved = JSON.parse(readFileSync(join(root, SETTINGS_FILE), 'utf8'))
  } catch {
    saved = {}
  }
  const configured = saved && typeof saved === 'object' ? (saved as { stages?: unknown }).stages : undefined
  const entries = configured && typeof configured === 'object' ? (configured as Record<string, unknown>) : {}
  return Object.fromEntries(
    Object.entries(MODEL_STAGE_DEFAULTS).map(([name, defaults]) => {
      const value = entries[name]
      if (!value || typeof value !== 'object') return [name, defaults]
      const { model, effort } = value as { model?: unknown; effort?: unknown }
      return [
        name,
        {
          model: typeof model === 'string' && model.trim() ? model.trim() : defaults.model,
          effort:
            typeof effort === 'string' && EFFORTS.has(effort)
              ? (effort as ModelStageSettings['effort'])
              : defaults.effort,
        },
      ]
    }),
  )
}

export function writeStageSettings(root: string, stages: unknown): Record<string, ModelStageSettings> {
  if (!stages || typeof stages !== 'object') throw new Error('Configurações de etapas inválidas')
  const settings = readStageSettings(root)
  for (const name of Object.keys(MODEL_STAGE_DEFAULTS)) {
    const value = (stages as Record<string, unknown>)[name]
    if (!value || typeof value !== 'object') continue
    const { model, effort } = value as { model?: unknown; effort?: unknown }
    if (typeof model !== 'string' || !model.trim()) throw new Error(`Modelo inválido para ${name}`)
    if (typeof effort !== 'string' || !EFFORTS.has(effort)) throw new Error(`Effort inválido para ${name}`)
    settings[name] = { model: model.trim(), effort: effort as ModelStageSettings['effort'] }
  }
  writeFileSync(join(root, SETTINGS_FILE), `${JSON.stringify({ stages: settings }, null, 2)}\n`)
  return settings
}
