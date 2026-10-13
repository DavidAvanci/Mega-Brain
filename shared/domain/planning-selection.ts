import type { Effort, LlmProvider, ModelStageSettings } from './settings'

export const JEV_PLANNING_MODEL = 'jev'
export const PLANNING_SELECTION_POLICY = 'planning-jev-1-independent-model-effort'
export const PLANNING_SELECTION_FILE = 'planning-selection.json'

export interface PlanningChoice {
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export interface PlanningSelection {
  source: 'jev' | 'fallback'
  provider: LlmProvider
  settings: ModelStageSettings
  requestedEffort?: Effort
  effortAdjusted?: boolean
  answers?: { planningModel: PlanningChoice; planningEffort: PlanningChoice }
  jevModelVersion?: string
  policyVersion: string
  processedAt: string
  inputHash: string
  reason?: string
  profileId?: string
}
