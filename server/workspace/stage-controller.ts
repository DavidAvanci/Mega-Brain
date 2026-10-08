import { readStageAgentRecord, validCheckpoint, writeStageAgentRecord } from './agent-checkpoint'
import { readCard } from './card-record'
import { rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { MegaBrainConfig } from '../config'
import { type ProcessChild, type ProcessOwner, type ProcessRunner } from '../process'
import type { CardData } from './card-record'
import { AGENT_FILE, runStageAgent } from './stage-agent'
import { readAgent } from './stage-agent-status'
import { stageOwnedFiles, STAGES, type Stage } from './stage-catalog'
import { discardStageSnapshot, restoreStageSnapshot } from './stage-snapshot'

type StageControllerConfig = Pick<MegaBrainConfig, 'executables' | 'worktreesDir' | 'preferences'>

export interface StageController {
  start(path: string, stage: Stage, card: CardData, model?: string): void
  stop(cardPath: string, requestedStage: unknown): Promise<void>
  pause(cardPath: string, requestedStage: unknown): Promise<void>
  resume(cardPath: string, requestedStage: unknown): void
  clear(cardPath: string, requestedStage: unknown): void
}

/** Owns in-process stage handles so cancellation affects only this app session. */
export function createStageController(
  config: StageControllerConfig,
  runner: ProcessRunner,
  owner?: ProcessOwner,
): StageController {
  const pausing = new Set<string>()
  const runningStages = new Map<string, { stage: string; child: ProcessChild }>()

  const start = (
    path: string,
    stage: Stage,
    card: CardData,
    model?: string,
    resume?: { record: import('./agent-checkpoint').StageAgentRecord; sessionId?: string },
  ) => {
    // Duas execuções no mesmo card disputam as worktrees dos itens e uma apaga a da outra
    if (
      pausing.has(path) ||
      runningStages.has(path) ||
      ['rodando', 'aguardando', ...(resume ? [] : ['pausado'])].includes(readAgent(path)?.status ?? '')
    )
      return
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
      resume ? (resume.record.provider === 'codex' ? 'chatgpt' : 'claude') : config.preferences.llmProvider,
      config.executables.codex,
      undefined,
      config.preferences.settingsFile,
      resume,
    )
  }

  const pause = async (cardPath: string, requestedStage: unknown) => {
    const agent = readAgent(cardPath)
    const record = readStageAgentRecord(cardPath)
    const run = runningStages.get(cardPath)
    if (pausing.has(cardPath)) throw new Error('A pausa já está em andamento')
    if (
      !agent ||
      agent.stage !== requestedStage ||
      !['rodando', 'aguardando'].includes(agent.status) ||
      !record ||
      !validCheckpoint(record.resume)
    )
      throw new Error('Essa execução não pode ser pausada')
    if (!run || run.stage !== requestedStage || !owner)
      throw new Error('Só é possível pausar agentes gerenciados por esta sessão do aplicativo')
    pausing.add(cardPath)
    try {
      // Save first: board polling must not advance or retry an interrupted stage.
      writeStageAgentRecord(cardPath, { ...record, sessionId: agent.sessionId, pausedAt: new Date().toISOString() })
      await owner.stop(run.child)
      runningStages.delete(cardPath)
      writeStageAgentRecord(cardPath, {
        ...readStageAgentRecord(cardPath),
        ...record,
        sessionId: agent.sessionId,
        pid: null,
        pausedAt: new Date().toISOString(),
      })
    } finally {
      pausing.delete(cardPath)
    }
  }

  const resume = (cardPath: string, requestedStage: unknown) => {
    if (pausing.has(cardPath) || runningStages.has(cardPath)) throw new Error('A execução ainda está encerrando')
    const agent = readAgent(cardPath)
    const record = readStageAgentRecord(cardPath)
    const stage = STAGES.find((candidate) => candidate.name === requestedStage)
    const card = readCard(cardPath, basename(cardPath))
    if (
      !stage ||
      agent?.stage !== stage.name ||
      agent.status !== 'pausado' ||
      !record ||
      !validCheckpoint(record.resume)
    )
      throw new Error('Não há uma execução pausada para retomar')
    if (card.status !== stage.status)
      throw new Error('O card mudou de etapa; restaure a etapa original antes de retomar')
    start(cardPath, stage, card, typeof record.model === 'string' ? record.model : undefined, {
      record,
      sessionId: agent.sessionId,
    })
  }

  const stop = async (cardPath: string, requestedStage: unknown) => {
    if (pausing.has(cardPath)) throw new Error('A pausa ainda está em andamento')
    const stageName = String(requestedStage ?? '')
    const stage = STAGES.find((candidate) => candidate.name === stageName)
    if (!stage) throw new Error('Etapa automática inválida')
    const agent = readAgent(cardPath)
    if (agent?.stage !== stage.name || !['rodando', 'aguardando', 'pausado'].includes(agent.status)) {
      throw new Error('Essa execução já terminou ou não está mais ativa')
    }
    const run = runningStages.get(cardPath)
    if (agent.status !== 'pausado' && (!run || run.stage !== stage.name)) {
      throw new Error('Não é possível interromper uma execução iniciada por outra sessão do aplicativo')
    }
    // Hide the run before signalling it so a concurrent board poll cannot advance the card.
    rmSync(join(cardPath, AGENT_FILE), { force: true })
    if (run) {
      if (owner) await owner.stop(run.child)
      else run.child.kill('SIGTERM')
    }
    runningStages.delete(cardPath)
    restoreStageSnapshot(cardPath, stage.name, agent.startedAt)
    for (const file of [`${stage.name}.jsonl`, `${stage.name}.log`]) {
      rmSync(join(cardPath, file), { force: true })
    }
  }

  const clear = (cardPath: string, requestedStage: unknown) => {
    const stageName = String(requestedStage ?? '')
    const stage = STAGES.find((candidate) => candidate.name === stageName)
    if (!stage) throw new Error('Etapa automática inválida')
    const agent = readAgent(cardPath)
    if (agent?.stage !== stage.name) throw new Error('Essa não é a última etapa registrada para o card')
    if (['rodando', 'aguardando', 'pausado'].includes(agent.status))
      throw new Error('Interrompa o agente antes de limpar a etapa')
    for (const file of [...stageOwnedFiles(stage), `${stage.name}.jsonl`, `${stage.name}.log`]) {
      rmSync(join(cardPath, file), { force: true, recursive: true })
    }
    discardStageSnapshot(cardPath, stage.name)
    rmSync(join(cardPath, AGENT_FILE), { force: true })
  }

  return { start, stop, pause, resume, clear }
}
