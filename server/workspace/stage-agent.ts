import { closeSync, openSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { claudeBin, codexBin } from '../agent-executable'
import { nodeProcessRunner, type ProcessChild, type ProcessOwner, type ProcessRunner } from '../process'
import { stderrJsonlLogger, type StructuredLogger } from '../logger'
import type { CardData } from './card-record'
import { stageScriptCommand } from './stage-command'
import { readStageSettings } from './stage-settings'
import { captureStageSnapshot } from './stage-snapshot'
import { stageOwnedFiles, type Stage } from './stage-catalog'

export const AGENT_FILE = 'agent.json'

type LlmProvider = 'claude' | 'chatgpt'
type StageLogger = Pick<StructuredLogger, 'event'>

export function settingsForStage(path: string, stage: Stage) {
  return (
    readStageSettings(dirname(path))[stage.name] ?? { model: stage.model ?? 'fable', effort: stage.effort ?? 'low' }
  )
}

export function stageAgentCommand(
  path: string,
  stage: Stage,
  card: CardData,
  model: string,
  effort: string,
  provider: LlmProvider = 'claude',
  claude?: string,
  codex?: string,
): [string, string[]] {
  if (stage.script) return stageScriptCommand(path, stage)

  const prompt = (stage.prompt as (currentCard: CardData) => string)(card)
  if (provider === 'chatgpt') {
    return [
      codexBin(codex),
      [
        'exec',
        '--json',
        '--dangerously-bypass-approvals-and-sandbox',
        ...(model && model !== 'default' ? ['--model', model] : []),
        ...(effort ? ['--config', `model_reasoning_effort="${effort}"`] : []),
        prompt,
      ],
    ]
  }
  return [
    claudeBin(claude),
    [
      '-p',
      prompt,
      '--model',
      model,
      ...(model.toLowerCase().includes('fable') ? ['--fallback-model', 'opus'] : []),
      '--effort',
      effort,
      '--dangerously-skip-permissions',
      '--output-format',
      'stream-json',
      '--verbose',
    ],
  ]
}

export function runStageAgent(
  path: string,
  stage: Stage,
  card: CardData,
  model: string | undefined = undefined,
  claude: string | undefined = undefined,
  runner: ProcessRunner = nodeProcessRunner,
  owner?: ProcessOwner,
  onSpawn?: (child: ProcessChild) => void,
  worktreesDir?: string,
  provider: LlmProvider = 'claude',
  codex?: string,
  logger?: StageLogger,
  settingsFile?: string,
): void {
  const settings = settingsForStage(path, stage)
  const effectiveModel = model ?? settings.model
  if (model === undefined) captureStageSnapshot(path, stage.name, stageOwnedFiles(stage))
  const out = openSync(join(path, `${stage.name}.jsonl`), 'w')
  const err = openSync(join(path, `${stage.name}.log`), 'a')
  const [bin, args] = stageAgentCommand(path, stage, card, effectiveModel, settings.effort, provider, claude, codex)
  const child = runner.spawn(bin, args, {
    cwd: path,
    detached: true,
    stdio: ['ignore', out, err],
    env: {
      ...process.env,
      CHECKLIST_MODEL: settings.model,
      CHECKLIST_EFFORT: settings.effort,
      MEGA_BRAIN_WORKTREES_DIR: worktreesDir ?? process.env.MEGA_BRAIN_WORKTREES_DIR,
      MEGA_BRAIN_SETTINGS_FILE: settingsFile ?? process.env.MEGA_BRAIN_SETTINGS_FILE,
      MEGA_BRAIN_LLM_PROVIDER: provider,
      MEGA_BRAIN_STAGE_SCRIPT: stage.script ? stage.name : undefined,
      MEGA_BRAIN_CLAUDE_BIN: claudeBin(claude),
      MEGA_BRAIN_CODEX_BIN: codex ?? process.env.MEGA_BRAIN_CODEX_BIN,
    },
  })
  owner?.own(child, { tree: true, label: `stage:${stage.name}` })
  onSpawn?.(child)
  child.on('error', () =>
    (logger ?? stderrJsonlLogger(process.stderr)).event('workspace.stage.error', { stage: stage.name }),
  )
  child.unref()
  closeSync(out)
  closeSync(err)
  writeFileSync(
    join(path, AGENT_FILE),
    `${JSON.stringify({ pid: child.pid ?? null, startedAt: new Date().toISOString(), stage: stage.name, model: effectiveModel }, null, 2)}\n`,
  )
}
