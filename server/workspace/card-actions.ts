import { readDevEnv } from '../modules/dev-environments/dev-env'
import type { MegaBrainConfig } from '../config'
import type { ProcessRunner } from '../process'
import { claudeBin, codexBin } from '../agent-executable'
import { readCard } from './card-record'
import { openBrowser, openTerminal } from './launchers'
import { readAgent } from './stage-agent-status'

type ActionConfig = Pick<MegaBrainConfig, 'executables' | 'preferences'>

export function openAgentTerminal(cardPath: string, config: ActionConfig, runner: ProcessRunner): void {
  const id = readAgent(cardPath)?.sessionId
  if (!id) throw new Error('O agente ainda não registrou a sessão')
  const command =
    config.preferences.llmProvider === 'chatgpt'
      ? [codexBin(config.executables.codex), 'resume', id]
      : [claudeBin(config.executables.claude), '--resume', id]
  openTerminal(cardPath, command, config.executables.terminal, runner)
}

export function openPullRequests(
  cardPath: string,
  cardName: string,
  environment: unknown,
  project: unknown,
  config: ActionConfig,
  runner: ProcessRunner,
): void {
  if (environment !== 'staging' && environment !== 'master') throw new Error(`Ambiente inválido: ${environment}`)
  const links = readCard(cardPath, cardName).prs?.[environment] ?? {}
  const selectedProject = typeof project === 'string' ? project : undefined
  const candidates = selectedProject ? [links[selectedProject]] : Object.values(links)
  const urls = candidates.filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
  if (!urls.length)
    throw new Error(selectedProject ? `Sem PR de ${environment} para ${selectedProject}` : `Sem PRs de ${environment}`)
  openBrowser(urls, config.executables.browser, runner, { newWindow: !selectedProject })
}

export function openDevEnvironment(cardPath: string, repo: unknown, config: ActionConfig, runner: ProcessRunner): void {
  const name = String(repo ?? '')
  const app = readDevEnv(cardPath)?.apps.find((candidate) => candidate.repo === name)
  if (app?.status !== 'rodando' || !app.url) throw new Error(`Ambiente não está rodando: ${name}`)
  const url = new URL(app.url)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password
  ) {
    throw new Error('URL do ambiente inválida')
  }
  openBrowser([url.origin], config.executables.browser, runner)
}

export function openDevEnvironmentAgent(cardPath: string, config: ActionConfig, runner: ProcessRunner): void {
  const command =
    config.preferences.llmProvider === 'chatgpt'
      ? [codexBin(config.executables.codex), '--dangerously-bypass-approvals-and-sandbox', '/run-test-env']
      : [claudeBin(config.executables.claude), '--model', 'haiku', '--dangerously-skip-permissions', '/run-test-env']
  openTerminal(cardPath, command, config.executables.terminal, runner)
}
