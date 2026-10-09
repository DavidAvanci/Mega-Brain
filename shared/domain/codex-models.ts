import type { BoardSettings, Effort, LlmProvider } from './settings'

export interface CodexModel {
  id: string
  label: string
  description: string
  supportedEfforts: Effort[]
  defaultEffort: Effort
  isDefault: boolean
}

export interface CodexModelCatalog {
  models: CodexModel[]
  source: 'codex' | 'fallback'
  defaultModelId?: string
  profileId?: string
  profileName?: string
}

export const EFFORT_DETAILS: Record<Effort, { label: string; description: string }> = {
  none: { label: 'None', description: 'Sem raciocínio adicional.' },
  minimal: { label: 'Minimal', description: 'Raciocínio mínimo para respostas rápidas.' },
  low: { label: 'Low', description: 'Mais rápido para tarefas simples e bem delimitadas.' },
  medium: { label: 'Medium', description: 'Equilíbrio entre velocidade e profundidade.' },
  high: { label: 'High', description: 'Mais análise para implementação, planejamento e revisão.' },
  xhigh: { label: 'X-high', description: 'Análise aprofundada para problemas com várias etapas e decisões.' },
  max: { label: 'Max', description: 'Maior profundidade em uma tarefa; prioriza qualidade sobre tempo e consumo.' },
  ultra: {
    label: 'Ultra',
    description: 'Raciocínio máximo com delegação automática a subagentes; indicado para trabalho divisível.',
  },
}
export const EFFORT_ORDER = Object.keys(EFFORT_DETAILS) as Effort[]
export const CLAUDE_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Offline reference, checked against Codex model/list and official docs on 2026-10-08.
// A live catalog always controls which models are offered to the current profile.
const model = (id: string, label: string, description: string, defaultEffort: Effort, ultra = true): CodexModel => ({
  id,
  label,
  description,
  defaultEffort,
  supportedEfforts: [...CLAUDE_EFFORTS, ...(ultra ? ['ultra' as const] : [])],
  isDefault: id === 'gpt-6.1-sol',
})
export const FALLBACK_CODEX_CATALOG: CodexModelCatalog = {
  source: 'fallback',
  models: [
    model(
      'gpt-6.1-sol',
      'GPT-6.1 Sol',
      'Modelo atual para programação e trabalho prolongado. Próximo ao Astra, com menor consumo.',
      'low',
    ),
    model(
      'gpt-6-astra',
      'GPT-6 Astra',
      'Para os problemas mais exigentes, com raciocínio e julgamento ao longo de várias etapas.',
      'medium',
    ),
    model('gpt-6-sol', 'GPT-6 Sol', 'Geração anterior do Sol para programação e trabalho geral.', 'medium'),
    model(
      'gpt-6-luna',
      'GPT-6 Luna',
      'Mais rápido e econômico para tarefas claras, repetitivas e bem delimitadas.',
      'medium',
      false,
    ),
    model('gpt-5.6-sol', 'GPT-5.6 Sol', 'Geração anterior; mantida para configurações existentes.', 'low'),
    model('gpt-5.6-terra', 'GPT-5.6 Terra', 'Modelo anterior equilibrado para tarefas diretas.', 'medium'),
    model('gpt-5.6-luna', 'GPT-5.6 Luna', 'Geração anterior do modelo rápido e econômico.', 'medium', false),
  ],
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && Object.hasOwn(EFFORT_DETAILS, value)
}

export function codexModelFor(modelId: string, catalog = FALLBACK_CODEX_CATALOG): CodexModel | undefined {
  return modelId === 'default'
    ? catalog.defaultModelId
      ? catalog.models.find((entry) => entry.id === catalog.defaultModelId)
      : (catalog.models.find((entry) => entry.isDefault) ?? catalog.models[0])
    : catalog.models.find((entry) => entry.id === modelId)
}

export function supportedEfforts(provider: LlmProvider, modelId: string, catalog = FALLBACK_CODEX_CATALOG): Effort[] {
  if (provider === 'claude') return CLAUDE_EFFORTS
  return (
    codexModelFor(modelId, catalog)?.supportedEfforts ??
    (modelId !== 'default' ? codexModelFor(modelId)?.supportedEfforts : undefined) ??
    CLAUDE_EFFORTS
  )
}

export function compatibleEffort(
  provider: LlmProvider,
  modelId: string,
  effort: Effort,
  catalog = FALLBACK_CODEX_CATALOG,
): Effort {
  const supported = supportedEfforts(provider, modelId, catalog)
  if (supported.includes(effort)) return effort
  const suggested = provider === 'chatgpt' ? codexModelFor(modelId, catalog)?.defaultEffort : 'low'
  return suggested && supported.includes(suggested) ? suggested : supported[0]
}

export function defaultStageSettings(provider: LlmProvider, catalog = FALLBACK_CODEX_CATALOG): BoardSettings {
  if (provider === 'claude')
    return {
      'task-planning': { model: 'fable', effort: 'high' },
      'run-task-checklist': { model: 'fable', effort: 'low' },
      'run-test-checklist': { model: 'sonnet', effort: 'low' },
    }
  const sol = catalog.models.some((entry) => entry.id === 'gpt-6.1-sol') ? 'gpt-6.1-sol' : 'default'
  const luna = catalog.models.some((entry) => entry.id === 'gpt-6-luna') ? 'gpt-6-luna' : sol
  const stage = (model: string, effort: Effort) => ({
    model,
    effort: compatibleEffort(provider, model, effort, catalog),
  })
  return {
    'task-planning': stage(sol, 'high'),
    'run-task-checklist': stage(sol, 'medium'),
    'run-test-checklist': stage(luna, 'high'),
  }
}

export function isClaudeModelAlias(value: string): boolean {
  return ['fable', 'opus', 'sonnet', 'haiku'].includes(value.toLowerCase())
}
