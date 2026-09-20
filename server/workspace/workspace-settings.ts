import { resolve } from 'node:path'
import { readGeneralSettings, writeGeneralSettings } from '../app-settings'
import type { MegaBrainConfig } from '../config'
import { detectEditors } from '../editor-detection'
import { readStageSettings, writeStageSettings } from './stage-settings'

export function availableWorkspaceEditors(config: MegaBrainConfig) {
  return detectEditors(config)
}

export function readWorkspaceSettings(config: MegaBrainConfig, root: string) {
  return { general: readGeneralSettings(config), stages: readStageSettings(root) }
}

export function writeWorkspaceSettings(config: MegaBrainConfig, data: Record<string, unknown>) {
  const general = data.general === undefined ? readGeneralSettings(config) : writeGeneralSettings(config, data.general)
  const root = resolve(config.workspaceDir)
  return {
    root,
    settings: {
      general,
      stages: data.stages === undefined ? readStageSettings(root) : writeStageSettings(root, data.stages),
    },
  }
}
