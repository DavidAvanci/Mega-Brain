import { resolve } from 'node:path'
import { readGeneralSettings, writeGeneralSettings, writePromptSettings } from '../app-settings'
import { DEFAULT_PROMPTS } from '../../shared/domain/settings'
import type { MegaBrainConfig } from '../config'
import { detectEditors } from '../editor-detection'
import { readStageSettings, writeStageSettings } from './stage-settings'

export function availableWorkspaceEditors(config: MegaBrainConfig) {
  return detectEditors(config)
}

export function readWorkspaceSettings(config: MegaBrainConfig, root: string) {
  return {
    general: readGeneralSettings(config),
    stages: readStageSettings(root),
    prompts: config.preferences.prompts ?? DEFAULT_PROMPTS,
  }
}

export function writeWorkspaceSettings(config: MegaBrainConfig, data: Record<string, unknown>) {
  const general = data.general === undefined ? readGeneralSettings(config) : writeGeneralSettings(config, data.general)
  const prompt = data.prompts && typeof data.prompts === 'object'
    ? writePromptSettings(config, data.prompts)
    : config.preferences.prompts ?? DEFAULT_PROMPTS
  const root = resolve(config.workspaceDir)
  return {
    root,
    settings: {
      general,
      stages: data.stages === undefined ? readStageSettings(root) : writeStageSettings(root, data.stages),
      prompts: prompt,
    },
  }
}
