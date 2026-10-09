import { resolve } from 'node:path'
import { readGeneralSettings, writeGeneralSettings, writePromptSettings } from '../app-settings'
import { DEFAULT_PROMPTS } from '../../shared/domain/settings'
import type { MegaBrainConfig } from '../config'
import { detectEditors } from '../editor-detection'
import { readStageSettings, validateStageSettings, writeStageSettings } from './stage-settings'
import { FALLBACK_CODEX_CATALOG, type CodexModelCatalog } from '../../shared/domain/codex-models'
import { migrateKnowledgeStorage } from '../knowledge/service'

export function availableWorkspaceEditors(config: MegaBrainConfig) {
  return detectEditors(config)
}

export function readWorkspaceSettings(config: MegaBrainConfig, root: string, catalog = FALLBACK_CODEX_CATALOG) {
  // Make the existing catalog available before Settings offers its folder shortcut.
  migrateKnowledgeStorage(config.preferences.settingsFile, config.workspaceDir)
  return {
    general: readGeneralSettings(config),
    stages: readStageSettings(root, config.preferences.llmProvider, catalog),
    prompts: config.preferences.prompts ?? DEFAULT_PROMPTS,
  }
}

export function writeWorkspaceSettings(
  config: MegaBrainConfig,
  data: Record<string, unknown>,
  catalog: CodexModelCatalog = FALLBACK_CODEX_CATALOG,
) {
  const provider =
    (data.general as { llmProvider?: unknown } | undefined)?.llmProvider === 'chatgpt'
      ? 'chatgpt'
      : data.general === undefined
        ? config.preferences.llmProvider
        : 'claude'
  if (data.stages !== undefined) validateStageSettings(data.stages, provider, catalog)
  const general = data.general === undefined ? readGeneralSettings(config) : writeGeneralSettings(config, data.general)
  const prompt =
    data.prompts && typeof data.prompts === 'object'
      ? writePromptSettings(config, data.prompts)
      : (config.preferences.prompts ?? DEFAULT_PROMPTS)
  const root = resolve(config.workspaceDir)
  return {
    root,
    settings: {
      general,
      stages:
        data.stages === undefined
          ? readStageSettings(root, general.llmProvider, catalog)
          : writeStageSettings(root, data.stages, general.llmProvider, catalog),
      prompts: prompt,
    },
  }
}
