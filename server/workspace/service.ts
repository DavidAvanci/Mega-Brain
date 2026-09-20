import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { startDevEnv, stopDevEnv } from '../modules/dev-environments/dev-env'
import { createOwnedProcessRunner, nodeProcessRunner, type ProcessOwner, type ProcessRunner } from '../process'
import { editorExecutable } from '../app-settings'
import { assertTestWorkspace } from '../test-safety'
import { createCard } from './card-folder'
import { createWorkspacePathResolver } from './path'
import { deleteCard } from './worktree-lifecycle'
import { listBoardCards } from './board-list'
import { openEditor } from './launchers'
import { createStageController } from './stage-controller'
import { inspectCard, inspectCardDiff } from './card-inspection'
import { completeWorkspaceConfig, type WorkspaceConfigInput } from './workspace-config'
import { openAgentTerminal, openDevEnvironment, openDevEnvironmentAgent, openPullRequests } from './card-actions'
import { updateCard } from './card-update'
import { availableWorkspaceEditors, readWorkspaceSettings, writeWorkspaceSettings } from './workspace-settings'

export { readCard, readPrs } from './card-record'
export { readTail } from '../agent-log'
export { externalAgentCwd, readExternalAgent } from '../agent-process'
export { repoDiff, worktreeRepoInfo } from './worktree-inspector'
export { stageScriptCommand } from './stage-command'
export { runStageAgent, settingsForStage, stageAgentCommand } from './stage-agent'
export { canRetryStageWithOpus, readAgent, stageEndedDueToRateLimit } from './stage-agent-status'
export { advanceStage, isResolvedAgentError, type StageStarter } from './stage-transition'
export { cardWorktreeRepos, deleteCard, expiredInProduction } from './worktree-lifecycle'
export { listBoardCards, type BoardStageStarter } from './board-list'
export { openBrowser, openEditor, openTerminal } from './launchers'
export { createStageController, type StageController } from './stage-controller'
export { inspectCard, inspectCardDiff, type CardFolderReference } from './card-inspection'
export { completeWorkspaceConfig, type WorkspaceConfigInput } from './workspace-config'
export { openAgentTerminal, openDevEnvironment, openDevEnvironmentAgent, openPullRequests } from './card-actions'
export { updateCard, type CardStageStarter } from './card-update'
export { availableWorkspaceEditors, readWorkspaceSettings, writeWorkspaceSettings } from './workspace-settings'
export { CARD_FILES } from './card-artifacts'
export { claudeBin, codexBin } from '../agent-executable'
export { FLOW_PROFILES, STAGES, stageFor, type Stage } from './stage-catalog'

export interface WorkspaceService {
  handle(path: string, method: string, query: URLSearchParams, body: unknown): Promise<unknown>
}

/** All workspace behavior is intentionally owned by this Vite-free service. */
export function createWorkspaceService(
  inputConfig: WorkspaceConfigInput,
  runner: ProcessRunner = nodeProcessRunner,
  owner?: ProcessOwner,
): WorkspaceService {
  const config = completeWorkspaceConfig(inputConfig)
  const stages = createStageController(config, runner, owner)
  return {
    async handle(path, method, query, body) {
      let root = resolve(config.workspaceDir)
      assertTestWorkspace(root)
      let paths = createWorkspacePathResolver(root)
      let folder = (value: unknown) => paths.resolveCardFolder(value)
      // Startup must be observational. Creating a missing configured workspace
      // is a deliberate consequence of the first workspace request instead.
      mkdirSync(root, { recursive: true })
      if (method === 'GET') {
        if (path === '/settings/editors') return availableWorkspaceEditors(config)
        if (path === '/settings') return readWorkspaceSettings(config, root)
        if (path === '/')
          return listBoardCards(root, resolve(config.worktreesDir), config.executables.git, runner, stages.start)
        const card = folder(query.get('name'))
        if (path === '/detail') return inspectCard(card, resolve(config.worktreesDir), config.executables.git, runner)
        if (path === '/diff') return inspectCardDiff(card.path, config.executables.git, runner)
        return listBoardCards(root, resolve(config.worktreesDir), config.executables.git, runner, stages.start)
      }
      if (method !== 'POST') throw new Error('Método não suportado')
      const data = (body ?? {}) as Record<string, unknown>
      if (path === '/settings') {
        const result = writeWorkspaceSettings(config, data)
        root = result.root
        assertTestWorkspace(root)
        mkdirSync(root, { recursive: true })
        paths = createWorkspacePathResolver(root)
        folder = (value: unknown) => paths.resolveCardFolder(value)
        return result.settings
      }
      if (path === '/open') {
        const card = folder(data.name)
        openEditor(card.path, editorExecutable(config), runner)
        return { ok: true }
      }
      if (path === '/') return createCard(root, data)
      const card = folder(data.name)
      const { name, path: cardPath } = card
      if (path === '/terminal') {
        openAgentTerminal(cardPath, config, runner)
        return { ok: true }
      }
      if (path === '/prs/open') {
        openPullRequests(cardPath, name, data.env, data.project, config, runner)
        return { ok: true }
      }
      if (path === '/dev-env/stop') {
        stopDevEnv(cardPath)
        return { ok: true }
      }
      if (path === '/dev-env/open') {
        openDevEnvironment(cardPath, data.repo, config, runner)
        return { ok: true }
      }
      if (path === '/dev-env/agent') {
        openDevEnvironmentAgent(cardPath, config, runner)
        return { ok: true }
      }
      if (path === '/stage/reset') {
        await stages.stop(cardPath, data.stage)
        return { ok: true }
      }
      if (path === '/dev-env')
        return {
          ok: true,
          ...startDevEnv(
            cardPath,
            data.frontend ? String(data.frontend) : undefined,
            owner ? createOwnedProcessRunner(runner, owner) : runner,
          ),
        }
      if (path === '/update') {
        updateCard(cardPath, name, data, stages.start)
        return { ok: true }
      }
      if (path === '/delete') {
        deleteCard(cardPath, resolve(config.worktreesDir), config.executables.git, runner)
        return { ok: true }
      }
      throw new Error('Rota não encontrada')
    },
  }
}
