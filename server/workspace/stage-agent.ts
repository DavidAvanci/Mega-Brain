import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { continuationArgs, writeStageAgentRecord, type StageAgentRecord } from './agent-checkpoint'
import { knowledgeContext, knowledgeAgentEnvironment } from '../knowledge/agent'
import { codexProfileEnvironment } from '../codex-profiles/service'
import { closeSync, openSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { claudeBin, codexBin } from '../agent-executable'
import { nodeProcessRunner, type ProcessChild, type ProcessOwner, type ProcessRunner } from '../process'
import { stderrJsonlLogger, type StructuredLogger } from '../logger'
import type { CardData } from './card-record'
import { stageScriptCommand } from './stage-command'
import { readStageSettings } from './stage-settings'
import { captureStageSnapshot } from './stage-snapshot'
import { planningPrompt, stageOwnedFiles, type Stage } from './stage-catalog'
import { repositoryMentionContext } from '../repositories/mentions'
import { taskMessageContext } from '../chat/task-conversation'
import { claudeCostFromStream, finishAgentUsage, setAgentUsageProcess, startAgentUsage } from './agent-usage'
import { DEFAULT_PROMPTS } from '../../shared/domain/settings'
import { isClaudeModelAlias } from '../../shared/domain/codex-models'

export const AGENT_FILE = 'agent.json'

type LlmProvider = 'claude' | 'chatgpt'
type StageLogger = Pick<StructuredLogger, 'event'>

export function settingsForStage(path: string, stage: Stage, provider: LlmProvider = 'claude') {
  return (
    readStageSettings(dirname(path), provider)[stage.name] ?? {
      model: stage.model ?? 'fable',
      effort: stage.effort ?? 'low',
    }
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
  settingsFile?: string,
): [string, string[]] {
  if (stage.script) return stageScriptCommand(path, stage)

  let instructions = DEFAULT_PROMPTS.taskPlanning
  if (settingsFile) {
    try {
      const saved = JSON.parse(readFileSync(settingsFile, 'utf8')) as { prompts?: { taskPlanning?: unknown } }
      if (typeof saved.prompts?.taskPlanning === 'string') instructions = saved.prompts.taskPlanning
    } catch {}
  }
  const stagePrompt =
    stage.name === 'task-planning'
      ? planningPrompt(card, instructions)
      : (stage.prompt as (currentCard: CardData) => string)(card)
  const prompt = knowledgeContext(
    repositoryMentionContext(`${stagePrompt}${taskMessageContext(path).prompt}`, settingsFile),
    card.knowledgeRefs,
    settingsFile,
  )
  const sessionName = `${basename(path)} · ${stage.name}`
  if (provider === 'chatgpt') {
    return [
      codexBin(codex),
      [
        'exec',
        '--json',
        '--dangerously-bypass-approvals-and-sandbox',
        ...(model && model !== 'default' && !isClaudeModelAlias(model) ? ['--model', model] : []),
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
      '--name',
      sessionName,
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
  resume?: { record: StageAgentRecord; sessionId?: string },
): void {
  const settings = settingsForStage(path, stage, provider)
  const effectiveModel = model ?? settings.model
  if (!resume && model === undefined) captureStageSnapshot(path, stage.name, stageOwnedFiles(stage))
  const usageId = stage.script
    ? undefined
    : startAgentUsage(path, new Date(), {
        label: stage.name,
        provider: provider === 'chatgpt' ? 'codex' : 'claude',
        model: effectiveModel,
      })
  if (resume) appendFileSync(join(path, `${stage.name}.jsonl`), `${JSON.stringify({ type: 'mega_brain.resume' })}\n`)
  const out = openSync(join(path, `${stage.name}.jsonl`), resume ? 'a' : 'w')
  const err = openSync(join(path, `${stage.name}.log`), 'a')
  const [bin, initialArgs] = stageAgentCommand(
    path,
    stage,
    card,
    effectiveModel,
    settings.effort,
    provider,
    claude,
    codex,
    settingsFile,
  )
  const stageMessages = taskMessageContext(path)
  const profileEnvironment = provider === 'chatgpt' && settingsFile ? codexProfileEnvironment(settingsFile) : {}
  const environment: NodeJS.ProcessEnv = {
    ...(provider === 'chatgpt' ? { CODEX_HOME: process.env.CODEX_HOME ?? join(homedir(), '.codex') } : {}),
    ...profileEnvironment,
    ...knowledgeAgentEnvironment(settingsFile, {
      kind: 'agent',
      name: provider === 'chatgpt' ? 'Codex' : 'Claude',
      taskId: basename(path),
      sessionId: `${basename(path)}:${stage.name}:${usageId ?? 'script'}`,
    }),
    CHECKLIST_MODEL: settings.model,
    CHECKLIST_EFFORT: settings.effort,
    MEGA_BRAIN_WORKTREES_DIR: worktreesDir ?? process.env.MEGA_BRAIN_WORKTREES_DIR,
    MEGA_BRAIN_SETTINGS_FILE: settingsFile ?? process.env.MEGA_BRAIN_SETTINGS_FILE,
    MEGA_BRAIN_LLM_PROVIDER: provider,
    MEGA_BRAIN_STAGE_SCRIPT: stage.script ? stage.name : undefined,
    MEGA_BRAIN_KNOWLEDGE_CONTEXT: knowledgeContext('', card.knowledgeRefs, settingsFile),
    MEGA_BRAIN_CARD_ID: basename(path),
    MEGA_BRAIN_CARD_PATH: path,
    MEGA_BRAIN_CLAUDE_BIN: claudeBin(claude),
    MEGA_BRAIN_CODEX_BIN: codex ?? process.env.MEGA_BRAIN_CODEX_BIN,
    MEGA_BRAIN_STAGE_RUN_ID: randomUUID(),
    ...resume?.record.resume?.environment,
    MEGA_BRAIN_RESUMING_STAGE: resume ? '1' : undefined,
  }
  const args = resume?.record.resume
    ? stage.script
      ? initialArgs
      : continuationArgs(
          provider === 'chatgpt' ? 'codex' : 'claude',
          resume.record.resume.args,
          resume.sessionId,
          stageMessages.prompt,
        )
    : initialArgs
  const savedEnvironment = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && !entry[0].includes('TOKEN') && entry[0] !== 'MEGA_BRAIN_RESUMING_STAGE',
    ),
  )
  const metadata: StageAgentRecord = {
    ...resume?.record,
    pid: null,
    pausedAt: undefined,
    startedAt: resume?.record.startedAt ?? new Date().toISOString(),
    stage: stage.name,
    model: effectiveModel,
    provider: provider === 'chatgpt' ? 'codex' : 'claude',
    codexProfileId: environment.MEGA_BRAIN_CODEX_PROFILE_ID,
    codexProfileName: environment.MEGA_BRAIN_CODEX_PROFILE_NAME,
    codexProfileColor: environment.MEGA_BRAIN_CODEX_PROFILE_COLOR,
    resume: resume?.record.resume ?? { args: initialArgs, environment: savedEnvironment },
  }
  writeStageAgentRecord(path, metadata)
  let child: ProcessChild
  try {
    child = runner.spawn(bin, args, {
      cwd: path,
      detached: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, ...environment },
    })
  } finally {
    closeSync(out)
    closeSync(err)
  }
  writeStageAgentRecord(path, { ...metadata, pid: child.pid ?? null })
  if (!stage.script) child.on('spawn', stageMessages.acknowledge)
  if (usageId) setAgentUsageProcess(path, usageId, child.pid, join(path, `${stage.name}.jsonl`))
  owner?.own(child, { tree: true, label: `stage:${stage.name}` })
  onSpawn?.(child)
  child.on('error', () =>
    (logger ?? stderrJsonlLogger(process.stderr)).event('workspace.stage.error', { stage: stage.name }),
  )
  if (usageId) {
    child.on('close', () => {
      let cost: number | undefined
      if (provider === 'claude') {
        try {
          cost = claudeCostFromStream(readFileSync(join(path, `${stage.name}.jsonl`), 'utf8'))
        } catch {}
      }
      finishAgentUsage(path, usageId, cost)
    })
  }
  child.unref()
}
