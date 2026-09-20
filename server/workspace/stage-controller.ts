import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { MegaBrainConfig } from '../config'
import { type ProcessChild, type ProcessOwner, type ProcessRunner } from '../process'
import type { CardData } from './card-record'
import { AGENT_FILE, runStageAgent } from './stage-agent'
import { readAgent } from './stage-agent-status'
import { STAGES, type Stage } from './stage-catalog'
import { restoreStageSnapshot } from './stage-snapshot'

type StageControllerConfig = Pick<MegaBrainConfig, 'executables' | 'worktreesDir' | 'preferences'>

export interface StageController {
  start(path: string, stage: Stage, card: CardData, model?: string): void
  stop(cardPath: string, requestedStage: unknown): Promise<void>
}

/** Owns in-process stage handles so cancellation affects only this app session. */
export function createStageController(
  config: StageControllerConfig,
  runner: ProcessRunner,
  owner?: ProcessOwner,
): StageController {
  const runningStages = new Map<string, { stage: string; child: ProcessChild }>()

  const start = (path: string, stage: Stage, card: CardData, model?: string) => {
    runStageAgent(
      path,
      stage,
      card,
      model,
      config.executables.claude,
      runner,
      owner,
      (child) => {
        const run = { stage: stage.name, child }
        runningStages.set(path, run)
        const forget = () => {
          if (runningStages.get(path) === run) runningStages.delete(path)
        }
        child.once('exit', forget)
        child.once('close', forget)
        child.once('error', forget)
      },
      config.worktreesDir,
      config.preferences.llmProvider,
      config.executables.codex,
    )
  }

  const stop = async (cardPath: string, requestedStage: unknown) => {
    const stageName = String(requestedStage ?? '')
    const stage = STAGES.find((candidate) => candidate.name === stageName)
    if (!stage) throw new Error('Etapa automática inválida')
    const agent = readAgent(cardPath)
    if (agent?.stage !== stage.name || agent.status !== 'rodando') {
      throw new Error('Essa execução já terminou ou não está mais ativa')
    }
    const run = runningStages.get(cardPath)
    if (!run || run.stage !== stage.name) {
      throw new Error('Não é possível interromper uma execução iniciada por outra sessão do aplicativo')
    }
    // Hide the run before signalling it so a concurrent board poll cannot advance the card.
    rmSync(join(cardPath, AGENT_FILE), { force: true })
    if (owner) await owner.stop(run.child)
    else run.child.kill('SIGTERM')
    runningStages.delete(cardPath)
    restoreStageSnapshot(cardPath, stage.name, agent.startedAt)
    for (const file of [`${stage.name}.jsonl`, `${stage.name}.log`]) {
      rmSync(join(cardPath, file), { force: true })
    }
  }

  return { start, stop }
}
