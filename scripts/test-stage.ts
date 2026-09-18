import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readDevEnv, startDevEnv } from '../devEnv.ts'
import { resetUnfinished, type Item } from './lib/checklist.ts'
import { activity, finish } from './lib/log.ts'
import { formatDuration, runChecklist } from './lib/scheduler.ts'
import { runClaudeItem } from './lib/executor.ts'
import { credentialsForEnvironment, type TestCredentials } from './lib/testCredentials.ts'

const wsPath = process.argv[2] ?? process.cwd()
const file = join(wsPath, 'TEST-CHECKLIST.md')
const screenshots = join(wsPath, 'screenshots')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface TestEnvironment {
  urls: Map<string, string>
  localBackend: boolean
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
  return {
    urls,
    localBackend: state.apps.some((app) => app.repo === 'api-garcom-digital' && app.kind === 'backend'),
  }
}

const CREDENTIALS_FILE = join(homedir(), '.claude', 'takeat-test-credentials.json')

function readCredentials(): TestCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null
  try {
    const parsed = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8'))
    if (!parsed?.email || !parsed?.password) return null
    return { email: parsed.email, password: parsed.password }
  } catch {
    return null
  }
}

function buildPrompt(item: Item, url: string | undefined, credentials: ReturnType<typeof readCredentials>): string {
  return [
    '/exec-test-item',
    '',
    `Cenário: ${item.id} — ${item.text}`,
    ...item.details.map((detail) => `  ${detail}`),
    `App: ${item.repo}${url ? ` — ${url}` : ''}`,
    `Sessão playwright: use sempre playwright-cli -s=${item.id}`,
    `Screenshots: salve em ${screenshots}/${item.id}-<passo>.png`,
    ...(credentials
      ? [`Login: se a tela pedir autenticação, entre com ${credentials.email} / ${credentials.password}`]
      : []),
    'Ao abrir o app podem aparecer modais de aviso empilhados: feche todos (botão "Ok, entendi" ou o X) antes de começar o cenário.',
  ].join('\n')
}

async function main() {
  if (!existsSync(file)) {
    finish(false, 'TEST-CHECKLIST.md não encontrado no workspace')
    return
  }
  resetUnfinished(file)
  mkdirSync(screenshots, { recursive: true })
  const environment = await ensureEnv()
  const credentials = credentialsForEnvironment(readCredentials(), environment.localBackend)

  const summary = await runChecklist({
    file,
    max: 3,
    execute: (item) =>
      runClaudeItem({
        cwd: wsPath,
        prompt: buildPrompt(
          item,
          environment.urls.get(item.repo) ?? [...environment.urls.values()][0],
          credentials,
        ),
        model: process.env.CHECKLIST_MODEL ?? 'sonnet',
        effort: process.env.CHECKLIST_EFFORT ?? 'low',
        tools: 'Bash,Read',
        maxTurns: 60,
        timeoutMs: 12 * 60_000,
      }),
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

main().catch((error) => {
  finish(false, error instanceof Error ? error.message : String(error))
  process.exit(1)
})
