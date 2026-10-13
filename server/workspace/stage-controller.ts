import { readStageAgentRecord, validCheckpoint, writeStageAgentRecord } from './agent-checkpoint'
import { readCard } from './card-record'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import type { MegaBrainConfig } from '../config'
import { type ProcessChild, type ProcessOwner, type ProcessRunner } from '../process'
import type { CardData } from './card-record'
import { AGENT_FILE, runStageAgent, settingsForStage } from './stage-agent'
import { readAgent } from './stage-agent-status'
import { stageFor, stageOwnedFiles, STAGES, type Stage } from './stage-catalog'
import { discardStageSnapshot, restoreStageSnapshot } from './stage-snapshot'
import { createPlanningSelectionService, type PlanningSelector } from '../planning-selection/service'
import {
  JEV_PLANNING_MODEL,
  PLANNING_SELECTION_FILE,
  type PlanningSelection,
} from '../../shared/domain/planning-selection'
import type { CodexModelCatalog } from '../../shared/domain/codex-models'
import { readStageSettings } from './stage-settings'
import { codexProfileEnvironment } from '../codex-profiles/service'

type StageControllerConfig = Pick<MegaBrainConfig, 'executables' | 'worktreesDir' | 'preferences'> &
  Partial<Pick<MegaBrainConfig, 'jev'>>

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
  codexModels?: () => Promise<CodexModelCatalog>,
  selectPlanning: PlanningSelector = createPlanningSelectionService(
    {
      ...config,
      jev: config.jev ?? { enabled: false },
    },
    codexModels,
  ),
): StageController {
  const pausing = new Set<string>()
  const runningStages = new Map<string, { stage: string; child: ProcessChild }>()
  const selecting = new Map<string, { id: string; controller: AbortController }>()

  const start = (
    path: string,
    stage: Stage,
    card: CardData,
    model?: string,
    resume?: { record: import('./agent-checkpoint').StageAgentRecord; sessionId?: string },
    selection?: PlanningSelection,
  ) => {
    // Duas execuções no mesmo card disputam as worktrees dos itens e uma apaga a da outra
    if (
      pausing.has(path) ||
      runningStages.has(path) ||
      selecting.has(path) ||
      ['rodando', 'aguardando', ...(resume ? [] : ['pausado'])].includes(readAgent(path)?.status ?? '')
    )
      return
    if (
      !resume &&
      !selection &&
      model === undefined &&
      stage.name === 'task-planning' &&
      settingsForStage(path, stage, config.preferences.llmProvider).model === JEV_PLANNING_MODEL
    ) {
      const saved = settingsForStage(path, stage, config.preferences.llmProvider)
      const provider = config.preferences.llmProvider
      const request = { id: randomUUID(), controller: new AbortController() }
      selecting.set(path, request)
      writeStageAgentRecord(path, {
        stage: stage.name,
        startedAt: new Date().toISOString(),
        pid: process.pid,
        provider: provider === 'chatgpt' ? 'codex' : 'claude',
        selectingWithJev: request.id,
      })
      void selectPlanning(card, saved, request.controller.signal)
        .then((result) => {
          if (
            request.controller.signal.aborted ||
            selecting.get(path) !== request ||
            !existsSync(join(path, 'card.json')) ||
            readStageAgentRecord(path)?.selectingWithJev !== request.id
          )
            return
          selecting.delete(path)
          rmSync(join(path, AGENT_FILE), { force: true })
          const current = readCard(path, basename(path))
          const currentStage = stageFor(current.status)
          if (!currentStage) return
          const currentSettings = readStageSettings(dirname(path), config.preferences.llmProvider)[stage.name]
          if (
            current.status !== card.status ||
            current.title !== card.title ||
            current.description !== card.description ||
            provider !== config.preferences.llmProvider ||
            JSON.stringify(saved) !== JSON.stringify(currentSettings) ||
            (result.source === 'jev' && !config.jev?.enabled) ||
            (result.profileId &&
              result.profileId !== codexProfileEnvironment(config.preferences.settingsFile).MEGA_BRAIN_CODEX_PROFILE_ID)
          ) {
            start(path, currentStage, current)
            return
          }
          writeFileSync(join(path, PLANNING_SELECTION_FILE), `${JSON.stringify(result, null, 2)}\n`)
          start(path, stage, current, undefined, undefined, result)
        })
        .catch(() => {
          // Cancellation, deletion and an unavailable folder must never start a late agent.
          if (request.controller.signal.aborted || !existsSync(path)) return
          try {
            if (readStageAgentRecord(path)?.selectingWithJev === request.id)
              writeStageAgentRecord(path, {
                stage: stage.name,
                pid: null,
                selectionError: 'Não foi possível preparar o planejamento.',
              })
          } catch {
            /* The card folder may have been removed or become unwritable. */
          }
        })
        .finally(() => {
          if (selecting.get(path) === request) selecting.delete(path)
        })
      return
    }
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
      selection,
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
    if (typeof record.pid === 'number') {
      let alive = false
      try {
        process.kill(record.pid, 0)
        alive = true
      } catch {
        /* The previous process has exited. */
      }
      if (alive) throw new Error('A execução anterior ainda está encerrando; aguarde antes de retomar')
    }
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
    const selection = selecting.get(cardPath)
    if (selection && stage.name === 'task-planning') {
      selection.controller.abort()
      selecting.delete(cardPath)
      if (readStageAgentRecord(cardPath)?.selectingWithJev === selection.id)
        rmSync(join(cardPath, AGENT_FILE), { force: true })
      return
    }
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
    restoreStageSnapshot(cardPath, stage.name)
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
    for (const file of [
      ...stageOwnedFiles(stage),
      `${stage.name}.jsonl`,
      `${stage.name}.log`,
      ...(stage.name === 'task-planning' ? [PLANNING_SELECTION_FILE] : []),
    ]) {
      rmSync(join(cardPath, file), { force: true, recursive: true })
    }
    discardStageSnapshot(cardPath, stage.name)
    rmSync(join(cardPath, AGENT_FILE), { force: true })
  }

  return { start, stop, pause, resume, clear }
}
