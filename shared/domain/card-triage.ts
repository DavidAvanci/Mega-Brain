import { FLOW_LEVELS, type FlowLevel } from './cards'

export const CARD_TRIAGE_POLICY_VERSION = 'card-triage-laya-2-direct-choice'

export interface CardTriageInput {
  title: string
  description: string
}
export type UnavailableReason =
  | 'disabled'
  | 'missing_key'
  | 'missing_url'
  | 'invalid_url'
  | 'invalid_key'
  | 'rate_limited'
  | 'timeout'
  | 'busy'
  | 'external_error'
interface Versioned {
  modelVersion: string
  policyVersion: string
  evidence?: {
    analysisId: string
    processedAt: string
    source: 'gateway' | 'cache'
    durationMs: number
    gatewayMs?: number
  }
}
export type CardTriageResult =
  | (Versioned & { status: 'suggested'; suggestedFlow: FlowLevel; probabilities: Record<FlowLevel, number> })
  | (Versioned & { status: 'unavailable'; reasonCode: UnavailableReason; retryable: boolean })

export function validateCardTriageResponse(value: unknown): CardTriageResult {
  if (!value || typeof value !== 'object') throw new Error('Resposta inválida da triagem Laya.')
  const result = value as CardTriageResult
  if (result.policyVersion !== CARD_TRIAGE_POLICY_VERSION)
    throw new Error('O backend da triagem Laya está desatualizado. Reinicie o Mega Brain com a versão atualizada.')
  if (result.status === 'unavailable') return result
  if (
    result.status !== 'suggested' ||
    !FLOW_LEVELS.includes(result.suggestedFlow) ||
    !result.probabilities ||
    !FLOW_LEVELS.every((flow) => {
      const probability = result.probabilities[flow]
      return typeof probability === 'number' && Number.isFinite(probability) && probability >= 0 && probability <= 1
    }) ||
    Math.abs(FLOW_LEVELS.reduce((sum, flow) => sum + result.probabilities[flow], 0) - 1) > 0.01
  )
    throw new Error('A resposta da Laya não contém as porcentagens de Simples, Médio e Difícil.')
  return result
}

export const TRIAGE_UNAVAILABLE_MESSAGES: Record<UnavailableReason, string> = {
  disabled: 'Triagem desabilitada. Você pode criar o card como Difícil sem sugestão.',
  missing_key: 'Configure a chave Laya para sugerir. Você pode criar o card como Difícil sem sugestão.',
  missing_url: 'Configure o endereço do gateway Laya. Você pode criar o card como Difícil sem sugestão.',
  invalid_url: 'Endereço do gateway Laya inválido. Revise a configuração.',
  invalid_key: 'Chave Laya rejeitada. Revise a configuração ou crie o card como Difícil sem sugestão.',
  rate_limited: 'Limite da Laya atingido. Tente novamente mais tarde ou crie o card como Difícil sem sugestão.',
  timeout: 'A análise demorou demais. Tente novamente ou crie o card como Difícil sem sugestão.',
  busy: 'Há análises em andamento. Tente novamente ou crie o card como Difícil sem sugestão.',
  external_error: 'Não foi possível sugerir agora. Você pode criar o card como Difícil sem sugestão.',
}
