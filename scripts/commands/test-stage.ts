import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readDevEnv, startDevEnv } from '../../server/modules/dev-environments/dev-env.ts'
import { activeRepositoryPath } from '../../server/repositories/catalog.ts'
import { readRepositoryEnvironmentVariables } from '../../server/repositories/environment-files.ts'
import { runsAsCommand } from '../lib/env.ts'
import { resetUnfinished, type Item } from '../lib/checklist.ts'
import { activity, finish } from '../lib/log.ts'
import { formatDuration, runChecklist } from '../lib/scheduler.ts'
import { runClaudeItem } from '../lib/executor.ts'
import { credentialsFromEnvironment } from '../lib/testCredentials.ts'

const wsPath = process.argv[2] ?? process.cwd()
const file = join(wsPath, 'TEST-CHECKLIST.md')
const screenshots = join(wsPath, 'screenshots')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface TestEnvironment {
  urls: Map<string, string>
}

async function ensureEnv(): Promise<TestEnvironment> {
  let state = readDevEnv(wsPath)
  if (state?.status !== 'rodando' && state?.status !== 'subindo') {
    activity('DevEnv', 'Subindo ambiente local')
    const result = startDevEnv(wsPath)
    if (result.needsFrontend?.length) {
      activity('DevEnv', `Escolhendo frontend ${result.needsFrontend[0]}`)
      startDevEnv(wsPath, result.needsFrontend[0])
    }
  }
  const deadline = Date.now() + 15 * 60_000
  for (;;) {
    state = readDevEnv(wsPath)
    if (state?.status === 'rodando') break
    if (state?.status === 'erro') throw new Error(`Ambiente local falhou: ${state.error ?? 'erro desconhecido'}`)
    if (Date.now() > deadline) throw new Error('Timeout subindo o ambiente local')
    await sleep(5000)
  }
  const urls = new Map<string, string>()
  for (const app of state.apps) {
    const url = app.url ?? (app.port ? `http://localhost:${app.port}` : undefined)
    if (url) urls.set(app.repo, url)
  }
  return { urls }
}

function readCredentials(repositoryAlias: string) {
  let repositoryPath: string
  try {
    repositoryPath = activeRepositoryPath(repositoryAlias)
  } catch {
    return null
  }
  return credentialsFromEnvironment(readRepositoryEnvironmentVariables(repositoryPath, 'local', [
    'TEST_LOGIN_EMAIL',
    'TEST_LOGIN_PASSWORD',
  ]))
}

function buildPrompt(item: Item, url: string | undefined, hasCredentials: boolean): string {
  return [
    '/exec-test-item',
    '',
    `Cenário: ${item.id} — ${item.text}`,
    ...item.details.map((detail) => `  ${detail}`),
    `App: ${item.repo}${url ? ` — ${url}` : ''}`,
    `Sessão playwright: use sempre playwright-cli -s=${item.id}`,
    `Screenshots: salve em ${screenshots}/${item.id}-<passo>.png`,
    ...(hasCredentials
      ? ['Login: se a tela pedir autenticação, use TEST_LOGIN_EMAIL e TEST_LOGIN_PASSWORD disponíveis no ambiente do processo. Nunca mostre nem registre seus valores.']
      : []),
    'Ao abrir o app podem aparecer modais de aviso empilhados: feche todos (botão "Ok, entendi" ou o X) antes de começar o cenário.',
  ].join('\n')
}

export async function runTestStage(): Promise<void> {
  if (!existsSync(file)) {
    finish(false, 'TEST-CHECKLIST.md não encontrado no workspace')
    return
  }
  resetUnfinished(file)
  mkdirSync(screenshots, { recursive: true })
  const environment = await ensureEnv()

  const summary = await runChecklist({
    file,
    max: 3,
    execute: (item) => {
      const credentials = readCredentials(item.repo)
      return runClaudeItem({
        cwd: wsPath,
        prompt: buildPrompt(item, environment.urls.get(item.repo) ?? [...environment.urls.values()][0], Boolean(credentials)),
        model: process.env.CHECKLIST_MODEL ?? 'sonnet',
        effort: process.env.CHECKLIST_EFFORT ?? 'low',
        tools: 'Bash,Read',
        maxTurns: 60,
        timeoutMs: 12 * 60_000,
        env: credentials
          ? { TEST_LOGIN_EMAIL: credentials.email, TEST_LOGIN_PASSWORD: credentials.password }
          : undefined,
      })
    },
  })

  finish(
    summary.ok,
    [
      `Cenários: ${summary.done}/${summary.total} passaram, ${summary.failed} falharam, ${summary.blocked} bloqueados · Custo: $${summary.costUsd.toFixed(2)} · Tempo de agente: ${formatDuration(summary.durationMs)}`,
      ...summary.failures.map((failure) => `${failure.id}: ${failure.note.split('\n')[0]}`),
    ].join('\n'),
  )
  process.exit(summary.ok ? 0 : 1)
}

if (runsAsCommand(import.meta.url)) {
  void runTestStage().catch((error) => {
    finish(false, error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
