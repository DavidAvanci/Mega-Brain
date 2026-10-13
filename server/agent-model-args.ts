import type { LlmProvider, ModelStageSettings } from '../shared/domain/settings'
import { compatibleEffort, isClaudeModelAlias } from '../shared/domain/codex-models'

export function agentModelArgs(provider: LlmProvider, settings: ModelStageSettings): string[] {
  const model = settings.model
  const effort = compatibleEffort(provider, model, settings.effort)
  if (provider === 'chatgpt') {
    return [
      ...(model !== 'default' && !isClaudeModelAlias(model) ? ['--model', model] : []),
      '--config',
      `model_reasoning_effort="${effort}"`,
    ]
  }
  return [
    ...(model !== 'default' ? ['--model', model] : []),
    '--effort',
    effort,
    ...(settings.fastMode ? ['--settings', JSON.stringify({ fastMode: true })] : []),
  ]
}
