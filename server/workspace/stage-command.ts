import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ScriptStage {
  name: string
  script?: string
}

export interface StageScriptCommandOptions {
  runtimeEntry?: string
  currentEntry?: string
  execPath?: string
  megaRoot?: string
}

const MEGA_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME_ENTRY = fileURLToPath(import.meta.url)

/** Resolves a stage script for both source mode and the self-contained runtime. */
export function stageScriptCommand(
  path: string,
  stage: ScriptStage,
  options: StageScriptCommandOptions = {},
): [string, string[]] {
  if (!stage.script) throw new Error(`A etapa ${stage.name} não possui script`)
  const runtimeEntry = options.runtimeEntry ?? RUNTIME_ENTRY
  const currentEntry = options.currentEntry ?? process.argv[1]
  const execPath = options.execPath ?? process.execPath
  const megaRoot = options.megaRoot ?? MEGA_ROOT
  const bundledRuntime =
    runtimeEntry.endsWith('.mjs') && Boolean(currentEntry) && resolve(currentEntry) === resolve(runtimeEntry)
  return bundledRuntime
    ? [execPath, [runtimeEntry, path]]
    : [join(megaRoot, 'node_modules', '.bin', 'tsx'), [join(megaRoot, stage.script), path]]
}
